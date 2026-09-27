from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from config import DATABASE_PATH

sqlite_url = f"sqlite:///{DATABASE_PATH}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

Base = declarative_base()

# Columns added after the first release; create_all() does not alter existing tables
MIGRATIONS = {
    "facilities": {
        "audit_answers_json": "TEXT DEFAULT '{}'",
        "audit_progress": "INTEGER DEFAULT 0",
        "setup_done": "BOOLEAN DEFAULT 0",
        "features_json": "TEXT DEFAULT '[]'",
        "assignments_json": "TEXT DEFAULT '{}'",
        "custom_duties_json": "TEXT DEFAULT '[]'",
        "reference_photos_json": "TEXT DEFAULT '{}'",
        "invite_token": "VARCHAR(32)",
        "geo_pending": "BOOLEAN DEFAULT 0",
        "qr_checkin": "BOOLEAN DEFAULT 0",
        "checkin_token": "VARCHAR(32)",
    },
    "employees": {
        "is_owner": "BOOLEAN DEFAULT 0",
        "archived": "BOOLEAN DEFAULT 0",
        "invite_token": "VARCHAR(32)",
    },
    "inspection_sessions": {
        "finished_at": "DATETIME",
    },
    "inspection_answers": {
        "source": "VARCHAR(20) DEFAULT 'user'",
        "updated_at": "DATETIME",
        "photos_json": "TEXT DEFAULT '[]'",
    },
    "defects": {
        "before_photos_json": "TEXT DEFAULT '[]'",
        "after_photos_json": "TEXT DEFAULT '[]'",
    },
    "shift_tasks": {
        "photos_json": "TEXT DEFAULT '[]'",
    },
}


# Fastapi dependency for db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Create tables and add missing columns to existing ones
def init_db():
    import models  # noqa: F401 - register models on Base

    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in MIGRATIONS.items():
            if not inspector.has_table(table):
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
