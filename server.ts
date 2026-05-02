import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("storyarc.db");
const JWT_SECRET = process.env.JWT_SECRET || "storyarc-super-secret-key";

// --- Database Initialization ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    bio TEXT,
    role TEXT DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (story_id) REFERENCES stories(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    UNIQUE(story_id, user_id),
    FOREIGN KEY (story_id) REFERENCES stories(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed initial categories if empty
const categoryCount = db.prepare("SELECT count(*) as count FROM categories").get() as { count: number };
if (categoryCount.count === 0) {
  const categories = ["Love", "Horror", "Motivation", "Sci-Fi", "Mystery", "History"];
  const insertCategory = db.prepare("INSERT INTO categories (name) VALUES (?)");
  categories.forEach(name => insertCategory.run(name));
}

// Seed some initial stories if empty
const storyCount = db.prepare("SELECT count(*) as count FROM stories").get() as { count: number };
if (storyCount.count === 0) {
  const horrorCategory = db.prepare("SELECT id FROM categories WHERE name = ?").get("Horror") as { id: number };
  const adminUser = db.prepare("SELECT id FROM users WHERE role = ?").get("admin") as { id: number } || 
                    db.prepare("SELECT id FROM users LIMIT 1").get() as { id: number };
  
  if (horrorCategory && adminUser) {
    const defaultStories = [
      {
        title: "The Whispering Walls",
        content: "In the heart of the ancient manor, the walls didn't just have ears—they had voices. Every night at midnight, the wallpaper would ripple like water, and muffled screams would drift from the plaster. Elias thought it was his imagination until he found the hidden room. It wasn't a room for people; it was a room for the voices. And now, they were calling his name.",
        user_id: adminUser.id,
        category_id: horrorCategory.id
      },
      {
        title: "The Static in the Mirror",
        content: "Mirror, mirror, on the wall... who is that standing behind me? Sarah hadn't touched the antique mirror in the attic for years. When she finally wiped away the dust, she didn't see her own reflection. She saw a version of herself, twisted and grey, screaming silently. But the worst part wasn't the reflection—it was the feeling of a cold hand touching her shoulder in the real world.",
        user_id: adminUser.id,
        category_id: horrorCategory.id
      }
    ];
    const insertStory = db.prepare("INSERT INTO stories (title, content, user_id, category_id) VALUES (?, ?, ?, ?)");
    defaultStories.forEach(s => insertStory.run(s.title, s.content, s.user_id, s.category_id));
  }
}

// --- Middleware ---
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const isAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: "Access denied. Admin only." });
  }
  next();
};

async function startServer() {
  const app = express();
  app.use(express.json());

  // --- API Routes ---

  // Auth
  app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      // Make first user admin for convenience
      const count = db.prepare("SELECT count(*) as count FROM users").get() as { count: number };
      const role = count.count === 0 ? 'admin' : 'user';
      
      const info = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(username, hashedPassword, role);
      res.json({ id: info.lastInsertRowid, message: "User registered" });
    } catch (e: any) {
      res.status(400).json({ error: "Username already exists or error occurred" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, bio: user.bio } });
  });

  app.get("/api/auth/profile", authenticateToken, (req: any, res) => {
    const user = db.prepare("SELECT id, username, role, bio FROM users WHERE id = ?").get(req.user.id);
    res.json(user);
  });

  app.put("/api/auth/profile", authenticateToken, (req: any, res) => {
    const { bio } = req.body;
    db.prepare("UPDATE users SET bio = ? WHERE id = ?").run(bio, req.user.id);
    res.json({ message: "Profile updated" });
  });

  // Categories
  app.get("/api/categories", (req, res) => {
    const categories = db.prepare("SELECT * FROM categories").all();
    res.json(categories);
  });

  // Stories
  app.get("/api/stories", (req, res) => {
    const { category_id, search, page = 1, limit = 10 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let query = `
      SELECT s.*, u.username as author_name, c.name as category_name, 
      (SELECT AVG(rating) FROM likes WHERE story_id = s.id) as avg_rating,
      (SELECT count(*) FROM likes WHERE story_id = s.id) as like_count
      FROM stories s
      JOIN users u ON s.user_id = u.id
      JOIN categories c ON s.category_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (category_id) {
      query += " AND s.category_id = ?";
      params.push(category_id);
    }
    if (search) {
      query += " AND (s.title LIKE ? OR s.content LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    query += " ORDER BY s.created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), offset);

    const stories = db.prepare(query).all(...params);
    const total = db.prepare("SELECT count(*) as count FROM stories WHERE 1=1 " + (category_id ? "AND category_id = ?" : "") + (search ? "AND (title LIKE ? OR content LIKE ?)" : "")).get(...params.slice(0, params.length - 2)) as any;

    res.json({ stories, total: total.count, page: Number(page), limit: Number(limit) });
  });

  app.get("/api/stories/:id", (req, res) => {
    const story = db.prepare(`
      SELECT s.*, u.username as author_name, c.name as category_name,
      (SELECT AVG(rating) FROM likes WHERE story_id = s.id) as avg_rating
      FROM stories s
      JOIN users u ON s.user_id = u.id
      JOIN categories c ON s.category_id = c.id
      WHERE s.id = ?
    `).get(req.params.id) as any;
    
    if (!story) return res.status(404).json({ error: "Story not found" });
    res.json(story);
  });

  app.post("/api/stories", authenticateToken, (req: any, res) => {
    const { title, content, category_id } = req.body;
    const info = db.prepare("INSERT INTO stories (title, content, user_id, category_id) VALUES (?, ?, ?, ?)").run(title, content, req.user.id, category_id);
    res.json({ id: info.lastInsertRowid });
  });

  app.put("/api/stories/:id", authenticateToken, (req: any, res) => {
    const { title, content, category_id } = req.body;
    const story = db.prepare("SELECT user_id FROM stories WHERE id = ?").get(req.params.id) as any;
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.user_id !== req.user.id && req.user.role !== 'admin') return res.sendStatus(403);

    db.prepare("UPDATE stories SET title = ?, content = ?, category_id = ? WHERE id = ?").run(title, content, category_id, req.params.id);
    res.json({ message: "Story updated" });
  });

  app.delete("/api/stories/:id", authenticateToken, (req: any, res) => {
    try {
      const story = db.prepare("SELECT user_id FROM stories WHERE id = ?").get(req.params.id) as any;
      console.log(`Deletion request for story ${req.params.id} by user ${req.user.id} (${req.user.role})`);
      
      if (!story) {
        console.log(`Story ${req.params.id} not found`);
        return res.status(404).json({ error: "Story not found in the archives" });
      }
      
      if (story.user_id !== req.user.id && req.user.role !== 'admin') {
        console.log(`Access denied for user ${req.user.id} to delete story ${req.params.id}`);
        return res.status(403).json({ error: "You lack the authority to erase this manuscript" });
      }

      // Explicitly delete related records
      const delComments = db.prepare("DELETE FROM comments WHERE story_id = ?").run(req.params.id);
      const delLikes = db.prepare("DELETE FROM likes WHERE story_id = ?").run(req.params.id);
      const delStory = db.prepare("DELETE FROM stories WHERE id = ?").run(req.params.id);
      
      console.log(`Deleted story ${req.params.id}. Comments removed: ${delComments.changes}, Likes removed: ${delLikes.changes}`);
      res.json({ message: "Manuscript successfully erased from the records" });
    } catch (error: any) {
      console.error('Error deleting story:', error);
      res.status(500).json({ error: "A catastrophic failure occurred within the archives" });
    }
  });

  // Comments
  app.get("/api/stories/:id/comments", (req, res) => {
    const comments = db.prepare(`
      SELECT c.*, u.username 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.story_id = ? 
      ORDER BY c.created_at DESC
    `).all(req.params.id);
    res.json(comments);
  });

  app.post("/api/comments", authenticateToken, (req: any, res) => {
    const { story_id, text } = req.body;
    const info = db.prepare("INSERT INTO comments (story_id, user_id, text) VALUES (?, ?, ?)").run(story_id, req.user.id, text);
    res.json({ id: info.lastInsertRowid });
  });

  // Likes/Ratings
  app.post("/api/likes", authenticateToken, (req: any, res) => {
    const { story_id, rating } = req.body;
    try {
      db.prepare("INSERT INTO likes (story_id, user_id, rating) VALUES (?, ?, ?) ON CONFLICT(story_id, user_id) DO UPDATE SET rating=excluded.rating").run(story_id, req.user.id, rating);
      res.json({ message: "Rating saved" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Admin Module
  app.get("/api/admin/stats", authenticateToken, isAdmin, (req, res) => {
    const userCount = db.prepare("SELECT count(*) as count FROM users").get() as any;
    const storyCount = db.prepare("SELECT count(*) as count FROM stories").get() as any;
    const commentCount = db.prepare("SELECT count(*) as count FROM comments").get() as any;
    res.json({ users: userCount.count, stories: storyCount.count, comments: commentCount.count });
  });

  app.get("/api/admin/users", authenticateToken, isAdmin, (req, res) => {
    const users = db.prepare("SELECT id, username, role, bio FROM users").all();
    res.json(users);
  });

  app.delete("/api/admin/users/:id", authenticateToken, isAdmin, (req: any, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "Cannot delete yourself" });
    
    // Get all story IDs from this user to clean up their comments
    const userStories = db.prepare("SELECT id FROM stories WHERE user_id = ?").all(req.params.id) as { id: number }[];
    userStories.forEach(s => {
      db.prepare("DELETE FROM comments WHERE story_id = ?").run(s.id);
      db.prepare("DELETE FROM likes WHERE story_id = ?").run(s.id);
    });

    db.prepare("DELETE FROM comments WHERE user_id = ?").run(req.params.id);
    db.prepare("DELETE FROM likes WHERE user_id = ?").run(req.params.id);
    db.prepare("DELETE FROM stories WHERE user_id = ?").run(req.params.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
    res.json({ message: "User and all their narratives have been expunged from the archives" });
  });

  app.delete("/api/comments/:id", authenticateToken, (req: any, res) => {
    const comment = db.prepare("SELECT user_id FROM comments WHERE id = ?").get(req.params.id) as any;
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.sendStatus(403);
    }

    db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.id);
    res.json({ message: "Comment deleted" });
  });

  app.delete("/api/admin/comments/:id", authenticateToken, isAdmin, (req, res) => {
    db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.id);
    res.json({ message: "Comment deleted by admin" });
  });

  // --- Vite Integration ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
