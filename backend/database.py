from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from config import PROJECT_ROOT

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
