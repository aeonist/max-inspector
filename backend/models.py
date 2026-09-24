from datetime import datetime
import json

from database import Base
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship


# Facility model
class Facility(Base):
    __tablename__ = "facilities"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(9), unique=True, index=True, nullable=False)
    inn = Column(String(12), unique=True, index=True, nullable=True)
    name = Column(String(255), default="Объект общественного питания", nullable=False)
    address = Column(String(500), nullable=True)
    geo_lat = Column(Float, nullable=True)
    geo_lon = Column(Float, nullable=True)
    geo_required = Column(Boolean, default=True)
    owner_user_id = Column(Integer, index=True, nullable=True)
    admin_pin = Column(String(4), default="1234", nullable=False)
    staff_count = Column(Integer, default=0)
    positions_json = Column(Text, default="[]")
    duties_json = Column(Text, default="[]")
    risk_category = Column(String(50), default="Умеренный риск")
    created_at = Column(DateTime, default=datetime.utcnow)

    employees = relationship("Employee", back_populates="facility")
    sessions = relationship("InspectionSession", back_populates="facility")


# Employee model
class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False)
    personal_code = Column(String(10), index=True, nullable=False)
    user_id = Column(Integer, index=True, nullable=True)
    full_name = Column(String(255), nullable=False)
    position = Column(String(100), nullable=False)
    shift_active = Column(Boolean, default=False)
    shift_started_at = Column(DateTime, nullable=True)
    shift_ended_at = Column(DateTime, nullable=True)
    last_geo_distance = Column(Float, nullable=True)
    completed_tasks_json = Column(Text, default="[]")
    task_photos_json = Column(Text, default="{}")

    facility = relationship("Facility", back_populates="employees")


# Inspection session model
class InspectionSession(Base):
    __tablename__ = "inspection_sessions"

    id = Column(Integer, primary_key=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False)
    geo_verified = Column(Boolean, default=False)
    distance_meters = Column(Float, default=0.0)
    compliance_score = Column(Float, default=0.0)
    status = Column(String(50), default="in_progress")
    created_at = Column(DateTime, default=datetime.utcnow)

    facility = relationship("Facility", back_populates="sessions")
    answers = relationship("InspectionAnswer", back_populates="session")
    tasks = relationship("Task", back_populates="session")
    declaration = relationship("Declaration", back_populates="session", uselist=False)


# Answer model
class InspectionAnswer(Base):
    __tablename__ = "inspection_answers"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("inspection_sessions.id"), nullable=False)
    item_id = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False)
    comment = Column(Text, nullable=True)
    photo_url = Column(String(500), nullable=True)

    session = relationship("InspectionSession", back_populates="answers")


# Task model
class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("inspection_sessions.id"), nullable=False)
    item_id = Column(Integer, nullable=True)
    title = Column(String(255), nullable=False)
    fine_amount = Column(Integer, default=30000)
    deadline_hours = Column(Integer, default=24)
    is_resolved = Column(Boolean, default=False)

    session = relationship("InspectionSession", back_populates="tasks")


# Declaration model
class Declaration(Base):
    __tablename__ = "declarations"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("inspection_sessions.id"), nullable=False)
    document_number = Column(String(100), unique=True, nullable=False)
    file_path = Column(String(500), nullable=False)
    valid_until = Column(DateTime, nullable=False)
    sha256_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("InspectionSession", back_populates="declaration")
