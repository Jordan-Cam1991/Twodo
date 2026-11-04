"""
Database access and schema management for TwoDo
Using Python built-in sqlite3.
"""
import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "twodo.db")

def get_connection():
    db_dir = os.path.dirname(DB_PATH)
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # Events table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        source TEXT,
        source_url TEXT,
        image_url TEXT,
        location_name TEXT,
        city TEXT,
        lat REAL,
        lng REAL,
        start_date TEXT,
        end_date TEXT,
        time_str TEXT,
        price_level TEXT,
        price_str TEXT,
        tags TEXT,
        insider_tip TEXT,
        is_custom INTEGER DEFAULT 0,
        created_at TEXT
    );
    """)

    # Votes table (collaborative couple voting)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS votes (
        event_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        vote TEXT NOT NULL, -- 'love', 'maybe', 'pass'
        note TEXT,          -- Love note explaining why partner loved the idea
        updated_at TEXT,
        PRIMARY KEY (event_id, user_name),
        FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    );
    """)

    # Ensure note column exists in votes table for existing DBs
    try:
        cursor.execute("ALTER TABLE votes ADD COLUMN note TEXT")
    except Exception:
        pass

    # Messages table (Emma & Jordan Private Couple Chat)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL,
        activity_id TEXT,
        activity_title TEXT,
        activity_image TEXT,
        created_at TEXT NOT NULL
    );
    """)

    # Seed friendly initial couple messages if table is empty
    cursor.execute("SELECT COUNT(*) as count FROM messages")
    if cursor.fetchone()["count"] == 0:
        cursor.execute("""
        INSERT INTO messages (sender_name, text, activity_id, activity_title, activity_image, created_at)
        VALUES 
        ('Emma', 'Hey Jordan! Found any cute date ideas for this weekend? 💕', NULL, NULL, NULL, datetime('now', '-2 hours')),
        ('Jordan', 'Check out the new matches on Discover! Adding a note on the ones I loved so you can see why 🎉', NULL, NULL, NULL, datetime('now', '-1 hours'))
        """)

    # Planner items table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS planner_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        status TEXT DEFAULT 'bucket_list', -- 'bucket_list', 'scheduled', 'completed'
        scheduled_date TEXT, -- YYYY-MM-DD
        time_slot TEXT, -- 'morning', 'afternoon', 'evening', 'night', or specific time
        notes TEXT,
        reservation_info TEXT,
        budget REAL DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    );
    """)

    # Couple profile & app settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS couple_profile (
        id INTEGER PRIMARY KEY,
        user1_name TEXT DEFAULT 'Emma',
        user1_color TEXT DEFAULT '#ec4899',
        user2_name TEXT DEFAULT 'Jordan',
        user2_color TEXT DEFAULT '#8b5cf6',
        default_city TEXT DEFAULT 'Brisbane',
        radius_km INTEGER DEFAULT 25,
        api_keys_json TEXT DEFAULT '{}'
    );
    """)

    # Ensure single row in couple_profile
    cursor.execute("SELECT COUNT(*) as count FROM couple_profile")
    if cursor.fetchone()["count"] == 0:
        cursor.execute("""
        INSERT INTO couple_profile (id, user1_name, user1_color, user2_name, user2_color, default_city, radius_km, api_keys_json)
        VALUES (1, 'Emma', '#ec4899', 'Jordan', '#8b5cf6', 'Brisbane', 25, '{}')
        """)

    # Migrate 'Partner' to 'Jordan'
    cursor.execute("UPDATE couple_profile SET user2_name = 'Jordan' WHERE user2_name = 'Partner'")
    cursor.execute("UPDATE votes SET user_name = 'Jordan' WHERE user_name = 'Partner'")

    conn.commit()
    conn.close()

def get_couple_profile():
    conn = get_connection()
    row = conn.execute("SELECT * FROM couple_profile WHERE id = 1").fetchone()
    conn.close()
    if row:
        return dict(row)
    return {
        "user1_name": "Emma",
        "user1_color": "#ec4899",
        "user2_name": "Jordan",
        "user2_color": "#8b5cf6",
        "default_city": "Brisbane",
        "radius_km": 25,
        "api_keys_json": "{}"
    }

def update_couple_profile(data):
    conn = get_connection()
    conn.execute("""
    UPDATE couple_profile SET
        user1_name = ?,
        user1_color = ?,
        user2_name = ?,
        user2_color = ?,
        default_city = ?,
        radius_km = ?,
        api_keys_json = ?
    WHERE id = 1
    """, (
        data.get("user1_name", "Emma"),
        data.get("user1_color", "#ec4899"),
        data.get("user2_name", "Jordan"),
        data.get("user2_color", "#8b5cf6"),
        data.get("default_city", "Brisbane"),
        data.get("radius_km", 25),
        json.dumps(data.get("api_keys", {})) if isinstance(data.get("api_keys"), dict) else data.get("api_keys_json", "{}")
    ))
    conn.commit()
    conn.close()
    return get_couple_profile()

def get_chat_messages(limit=200):
    conn = get_connection()
    rows = conn.execute("""
    SELECT id, sender_name, text, activity_id, activity_title, activity_image, created_at
    FROM messages
    ORDER BY id ASC
    LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_chat_message(sender_name, text, activity_id=None, activity_title=None, activity_image=None):
    from datetime import datetime
    now_str = datetime.now().isoformat()
    conn = get_connection()
    with conn:
        cursor = conn.execute("""
        INSERT INTO messages (sender_name, text, activity_id, activity_title, activity_image, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (sender_name, text, activity_id, activity_title, activity_image, now_str))
        msg_id = cursor.lastrowid
    conn.close()
    return {
        "id": msg_id,
        "sender_name": sender_name,
        "text": text,
        "activity_id": activity_id,
        "activity_title": activity_title,
        "activity_image": activity_image,
        "created_at": now_str
    }
