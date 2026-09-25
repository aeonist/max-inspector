from pathlib import Path

from config import PROJECT_ROOT
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Database file path
sqlite_file = PROJECT_ROOT / "inspector.db"
sqlite_url = f"sqlite:///{sqlite_file}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

Base = declarative_base()


# Fastapi dependency for db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Initialize database and migrate columns safely
def init_db():
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        # Check and add audit_answers_json
        try:
            conn.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE facilities ADD COLUMN audit_answers_json TEXT DEFAULT '{}'"
                )
            )
            conn.commit()
        except Exception:
            pass
        # Check and add audit_progress
        try:
            conn.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE facilities ADD COLUMN audit_progress INTEGER DEFAULT 0"
                )
            )
            conn.commit()
        except Exception:
            pass
