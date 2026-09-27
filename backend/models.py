import json

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base
from utils.timefmt import utcnow


# Read and write JSON text columns as Python values
def _load(raw, default):
    try:
        value = json.loads(raw) if raw else default
    except (TypeError, ValueError):
        return default
    return value if isinstance(value, type(default)) else default


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False)


# Facility model
class Facility(Base):
    __tablename__ = "facilities"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(9), unique=True, index=True, nullable=False)
    inn = Column(String(12), unique=True, index=True, nullable=True)
    name = Column(String(255), default="Моё заведение", nullable=False)
    address = Column(String(500), nullable=True)
    geo_lat = Column(Float, nullable=True)
    geo_lon = Column(Float, nullable=True)
    geo_required = Column(Boolean, default=True)
    # Waiting for the owner to send the facility location in the bot chat
    geo_pending = Column(Boolean, default=False)
    owner_user_id = Column(Integer, index=True, nullable=True)
    setup_done = Column(Boolean, default=False)
    invite_token = Column(String(32), unique=True, index=True, nullable=True)
    positions_json = Column(Text, default="[]")
    # Checklist conditions that apply to this facility ("applies_to" values)
    features_json = Column(Text, default="[]")
    # Shift duty -> position: {"<item_id>": "Повар"}
    assignments_json = Column(Text, default="{}")
    # Owner's own shift duties: [{"id": 1001, "question": "...", "position": "..."}]
    custom_duties_json = Column(Text, default="[]")
    # Facility's own "as it should be" photos: {"<item_id>": "/uploads/..."}
    reference_photos_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=utcnow)

    # Legacy columns of the first version, kept so old databases keep working
    admin_pin = Column(String(4), default="0000", nullable=False)
    staff_count = Column(Integer, default=0)
    duties_json = Column(Text, default="[]")
    risk_category = Column(String(50), default="")
    audit_answers_json = Column(Text, default="{}")
    audit_progress = Column(Integer, default=0)

    employees = relationship("Employee", back_populates="facility")
    sessions = relationship("InspectionSession", back_populates="facility")

    @property
    def positions(self) -> list[str]:
        items = _load(self.positions_json, [])
        # First version stored [{"name": "..."}]
        return [p["name"] if isinstance(p, dict) else str(p) for p in items]

    @positions.setter
    def positions(self, value: list[str]):
        self.positions_json = _dump(value)

    @property
    def features(self) -> list[str]:
        return _load(self.features_json, [])

    @features.setter
    def features(self, value: list[str]):
        self.features_json = _dump(value)

    @property
    def assignments(self) -> dict:
        return _load(self.assignments_json, {})

    @assignments.setter
    def assignments(self, value: dict):
        self.assignments_json = _dump(value)

    @property
    def custom_duties(self) -> list[dict]:
        return _load(self.custom_duties_json, [])

    @custom_duties.setter
    def custom_duties(self, value: list[dict]):
        self.custom_duties_json = _dump(value)

    @property
    def reference_photos(self) -> dict:
        return _load(self.reference_photos_json, {})

    @reference_photos.setter
    def reference_photos(self, value: dict):
        self.reference_photos_json = _dump(value)

    @property
    def has_coords(self) -> bool:
        return self.geo_lat is not None and self.geo_lon is not None


# Employee model (the owner gets one too when working shifts)
class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False)
    personal_code = Column(String(10), index=True, nullable=False)
    user_id = Column(Integer, index=True, nullable=True)
    full_name = Column(String(255), nullable=False)
    position = Column(String(100), nullable=False)
    is_owner = Column(Boolean, default=False)
    # Removed from staff; kept for shift and fix history
    archived = Column(Boolean, default=False)

    # Legacy shift columns of the first version; shifts live in the Shift table now
    shift_active = Column(Boolean, default=False)
    shift_started_at = Column(DateTime, nullable=True)
    shift_ended_at = Column(DateTime, nullable=True)
    last_geo_distance = Column(Float, nullable=True)
    completed_tasks_json = Column(Text, default="[]")
    task_photos_json = Column(Text, default="{}")

    facility = relationship("Facility", back_populates="employees")
    shifts = relationship("Shift", back_populates="employee", order_by="Shift.id")


# One work shift of an employee
class Shift(Base):
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False, index=True)
    started_at = Column(DateTime, default=utcnow, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    # "verified": inside the radius; "not_required": geo control off; "no_coords": facility location unknown
    geo_status = Column(String(20), default="not_required")
    geo_distance = Column(Float, nullable=True)

    employee = relationship("Employee", back_populates="shifts")
    tasks = relationship("ShiftTask", back_populates="shift", cascade="all, delete-orphan")

    @property
    def active(self) -> bool:
        return self.ended_at is None


# Shift duty marked as done during a shift
class ShiftTask(Base):
    __tablename__ = "shift_tasks"
    __table_args__ = (UniqueConstraint("shift_id", "item_id"),)

    id = Column(Integer, primary_key=True, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"), nullable=False, index=True)
    item_id = Column(Integer, nullable=False)
    done_at = Column(DateTime, default=utcnow, nullable=False)
    photo_url = Column(String(500), nullable=True)

    shift = relationship("Shift", back_populates="tasks")


# Owner's internal audit against the inspection checklist
class InspectionSession(Base):
    __tablename__ = "inspection_sessions"

    id = Column(Integer, primary_key=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False)
    status = Column(String(50), default="in_progress")
    created_at = Column(DateTime, default=utcnow)
    finished_at = Column(DateTime, nullable=True)
    # Legacy columns of the first version
    geo_verified = Column(Boolean, default=False)
    distance_meters = Column(Float, default=0.0)
    compliance_score = Column(Float, default=0.0)

    facility = relationship("Facility", back_populates="sessions")
    answers = relationship("InspectionAnswer", back_populates="session")


# Answer to one checklist question
class InspectionAnswer(Base):
    __tablename__ = "inspection_answers"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("inspection_sessions.id"), nullable=False)
    item_id = Column(Integer, nullable=False)
    # "compliant" | "violation" | "na"
    status = Column(String(20), nullable=False)
    # "user": answered by the owner; "features": set from the setup wizard; "fix": accepted fix
    source = Column(String(20), default="user")
    comment = Column(Text, nullable=True)
    photo_url = Column(String(500), nullable=True)
    updated_at = Column(DateTime, default=utcnow)

    session = relationship("InspectionSession", back_populates="answers")


# Violation found in the audit (or reported by staff) and its fix cycle
class Defect(Base):
    __tablename__ = "defects"

    id = Column(Integer, primary_key=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("inspection_sessions.id"), nullable=True)
    # Checklist item; None for a problem reported by staff
    item_id = Column(Integer, nullable=True)
    # "audit" | "problem"
    kind = Column(String(20), default="audit")
    title = Column(String(500), nullable=False)
    comment = Column(Text, nullable=True)
    # Who fixes it: a position, or the owner personally
    assigned_position = Column(String(100), nullable=True)
    to_owner = Column(Boolean, default=False)
    # "open" -> "fixed" (awaiting review) -> "accepted"; "returned" goes back to "fixed"; "cancelled"
    status = Column(String(20), default="open", index=True)
    before_photo = Column(String(500), nullable=True)
    after_photo = Column(String(500), nullable=True)
    return_reason = Column(String(255), nullable=True)
    reported_by_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    fixed_by_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    fixed_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)

    fixed_by = relationship("Employee", foreign_keys=[fixed_by_employee_id])
