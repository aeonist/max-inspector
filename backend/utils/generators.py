import random
import secrets

from sqlalchemy.orm import Session

from models import Employee, Facility


# Generate unique facility code XXXX-XXXX
def generate_unique_facility_code(db: Session) -> str:
    while True:
        part1 = random.randint(1000, 9999)
        part2 = random.randint(1000, 9999)
        candidate = f"{part1}-{part2}"
        existing = db.query(Facility).filter(Facility.code == candidate).first()
        if not existing:
            return candidate


# Generate unique staff personal code XXXX
def generate_unique_employee_code(db: Session, facility_id: int) -> str:
    while True:
        candidate = str(random.randint(1000, 9999))
        existing = (
            db.query(Employee)
            .filter(
                Employee.facility_id == facility_id,
                Employee.personal_code == candidate,
            )
            .first()
        )
        if not existing:
            return candidate


# Unguessable token for a personal staff invite
def generate_invite_token(db: Session) -> str:
    while True:
        candidate = secrets.token_urlsafe(12)
        if not db.query(Employee).filter(Employee.invite_token == candidate).first():
            return candidate
