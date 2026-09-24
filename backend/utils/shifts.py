from datetime import datetime
from sqlalchemy.orm import Session
from models import Employee


# Auto expire shifts older than 12 hours
def expire_old_shifts(db: Session, facility_id: int | None = None):
    query = db.query(Employee).filter(Employee.shift_active == True)
    if facility_id:
        query = query.filter(Employee.facility_id == facility_id)
    for emp in query.all():
        if emp.shift_started_at:
            age = (datetime.utcnow() - emp.shift_started_at).total_seconds() / 3600
            if age >= 12:
                emp.shift_active = False
                emp.shift_ended_at = datetime.utcnow()
    db.commit()
