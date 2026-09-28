
from sqlalchemy.orm import Session

from config import FRONTEND_DIR, READY_INDEX_PERCENT, UPLOADS_DIR
from models import Defect, Employee, Facility, InspectionAnswer, InspectionSession
from services.checklist import (
    OWNER_TASK_TYPES,
    get_item,
    is_not_applicable,
    is_shift_item,
    load_checklist,
)
from utils.timefmt import format_local_datetime, utcnow

ANSWER_STATUSES = {"compliant", "violation", "na"}
# Defect statuses that still need action
UNRESOLVED = ("open", "returned", "fixed")


# The audit in progress (one rolling audit per facility)
def current_session(db: Session, facility: Facility) -> InspectionSession:
    session = (
        db.query(InspectionSession)
        .filter(InspectionSession.facility_id == facility.id)
        .order_by(InspectionSession.id.desc())
        .first()
    )
    if not session:
        session = InspectionSession(facility_id=facility.id, status="in_progress")
        db.add(session)
        db.commit()
    return session


def answers_by_item(db: Session, session: InspectionSession) -> dict[int, InspectionAnswer]:
    rows = db.query(InspectionAnswer).filter(InspectionAnswer.session_id == session.id).all()
    return {a.item_id: a for a in rows}


def _upsert_answer(db: Session, session, item_id: int, status: str, source: str, photos: list[str]):
    answer = (
        db.query(InspectionAnswer)
        .filter(InspectionAnswer.session_id == session.id, InspectionAnswer.item_id == item_id)
        .first()
    )
    if not answer:
        answer = InspectionAnswer(session_id=session.id, item_id=item_id, status=status)
        db.add(answer)
    answer.status = status
    answer.source = source
    answer.photos = photos
    answer.updated_at = utcnow()
    return answer


def _set_reference(facility: Facility, item_id: int, photo_url: str) -> None:
    refs = facility.reference_photos
    refs[str(item_id)] = photo_url
    facility.reference_photos = refs


# Mark conditional items "not applicable" per the wizard's "what do you have" answers
def sync_features(db: Session, facility: Facility) -> None:
    session = current_session(db, facility)
    answers = answers_by_item(db, session)
    for item in load_checklist():
        if not item.get("applies_to"):
            continue
        answer = answers.get(item["id"])
        if is_not_applicable(item, facility.features):
            if not answer or answer.source == "features":
                _upsert_answer(db, session, item["id"], "na", "features", [])
        elif answer and answer.source == "features":
            db.delete(answer)
    db.commit()


def unresolved_defects(db: Session, facility: Facility):
    return (
        db.query(Defect)
        .filter(Defect.facility_id == facility.id, Defect.status.in_(UNRESOLVED))
        .order_by(Defect.id.desc())
        .all()
    )


def _unresolved_for_item(db: Session, facility: Facility, item_id: int) -> Defect | None:
    return (
        db.query(Defect)
        .filter(
            Defect.facility_id == facility.id,
            Defect.item_id == item_id,
            Defect.status.in_(UNRESOLVED),
        )
        .first()
    )


# Staff with a linked MAX account on a position (the owner counts if working shifts)
def linked_staff(db: Session, facility: Facility, position: str | None) -> list[Employee]:
    if not position:
        return []
    return (
        db.query(Employee)
        .filter(
            Employee.facility_id == facility.id,
            Employee.position == position,
            Employee.user_id.isnot(None),
        )
        .all()
    )


# The owner's own employee profile while the owner works shifts
def owner_employee(db: Session, facility: Facility, include_archived: bool = False) -> Employee | None:
    query = db.query(Employee).filter(Employee.facility_id == facility.id, Employee.is_owner.is_(True))
    if not include_archived:
        query = query.filter(Employee.archived.isnot(True))
    return query.order_by(Employee.id.desc()).first()


# Who fixes a violation: a position with linked staff, otherwise the owner personally
def resolve_assignee(db: Session, facility: Facility, item: dict, assign_to: str | None) -> tuple[str | None, bool]:
    if item.get("task_type") in OWNER_TASK_TYPES or assign_to == "owner":
        return None, True
    position = assign_to or facility.assignments.get(str(item["id"])) or item.get("default_role")
    if not linked_staff(db, facility, position):
        return position, True
    return position, False


# Save an audit answer; a violation creates (or updates) its defect, other answers cancel it
def set_answer(
    db: Session,
    facility: Facility,
    item_id: int,
    status: str,
    photos: list[str],
    assign_to: str | None = None,
) -> tuple[InspectionAnswer, Defect | None, bool]:
    item = get_item(item_id)
    if not item:
        raise ValueError("Пункт проверочного листа не найден")
    if status not in ANSWER_STATUSES:
        raise ValueError("Неизвестный ответ")
    # A violation needs a photo for the person who fixes it; "compliant" only if the owner requires it
    if status == "violation" and not photos:
        raise ValueError("Сфотографируйте нарушение")

    if status == "na":
        photos = []

    session = current_session(db, facility)
    previous = answers_by_item(db, session).get(item_id)
    # Confirming "compliant" again without photos keeps the photos already attached
    if status == "compliant" and not photos and previous and previous.status == "compliant":
        photos = previous.photos
    if status == "compliant" and not photos and facility.settings["compliant_photo_required"]:
        raise ValueError("Сфотографируйте, что требование соблюдается: так настроено в правилах работы")
    answer = _upsert_answer(db, session, item_id, status, "user", photos)
    defect = _unresolved_for_item(db, facility, item_id)
    created = False

    # A photo confirming compliance becomes this facility's "as it should be" reference
    if status == "compliant" and photos:
        _set_reference(facility, item_id, photos[0])

    if status == "violation":
        position, to_owner = resolve_assignee(db, facility, item, assign_to)
        if not defect:
            defect = Defect(facility_id=facility.id, item_id=item_id, kind="audit", title=item["question"])
            db.add(defect)
            created = True
        defect.session_id = session.id
        defect.assigned_position = position
        defect.to_owner = to_owner
        defect.status = "open"
        defect.before_photos = photos
        defect.after_photos = []
        defect.return_reason = None
        defect.created_at = utcnow()
    elif defect:
        defect.status = "cancelled"
        defect.closed_at = utcnow()
        defect = None

    db.commit()
    return answer, defect, created


# Defect waiting for this employee: by position; the owner on shift may fix any shift violation
def is_for_employee(defect: Defect, emp: Employee) -> bool:
    if emp.is_owner:
        item = get_item(defect.item_id) if defect.item_id else None
        return bool(item) and is_shift_item(item)
    return not defect.to_owner and defect.assigned_position == emp.position


def defects_for_employee(db: Session, emp: Employee) -> list[Defect]:
    return [d for d in unresolved_defects(db, emp.facility) if is_for_employee(d, emp)]


# Employees who get the violation card in the chat
def defect_recipients(db: Session, facility: Facility, defect: Defect) -> list[Employee]:
    if not defect.to_owner:
        return linked_staff(db, facility, defect.assigned_position)
    item = get_item(defect.item_id) if defect.item_id else None
    owner_emp = owner_employee(db, facility)
    # The owner gets a shift violation as a card only when working shifts himself
    if owner_emp and owner_emp.user_id and item and is_shift_item(item):
        return [owner_emp]
    return []


def mark_fixed(db: Session, defect: Defect, employee: Employee, photos: list[str]) -> None:
    if defect.status not in ("open", "returned"):
        raise ValueError("Это нарушение уже на проверке или закрыто")
    defect.status = "fixed"
    defect.after_photos = photos
    defect.fixed_by_employee_id = employee.id
    defect.fixed_at = utcnow()
    db.commit()


# Owner accepts the fix: the checklist item becomes compliant and the index grows.
# The "after" photo becomes the reference when the owner took it or the rules allow staff photos
def accept_defect(db: Session, defect: Defect, by_owner: bool = False) -> None:
    if defect.status == "accepted":
        return
    if defect.status not in UNRESOLVED:
        raise ValueError("Это нарушение уже закрыто")
    defect.status = "accepted"
    defect.closed_at = utcnow()
    if defect.item_id:
        facility = db.get(Facility, defect.facility_id)
        session = current_session(db, facility)
        _upsert_answer(db, session, defect.item_id, "compliant", "fix", defect.after_photos)
        owner_photo = by_owner or bool(defect.fixed_by and defect.fixed_by.is_owner)
        if defect.after_photos and (owner_photo or facility.settings["reference_from_fixes"]):
            _set_reference(facility, defect.item_id, defect.after_photos[0])
    db.commit()


def return_defect(db: Session, defect: Defect, reason: str) -> None:
    if defect.status != "fixed":
        raise ValueError("Вернуть можно только исправление, которое ждёт проверки")
    defect.status = "returned"
    defect.return_reason = reason
    db.commit()


# Owner closes their own task directly; an audit item needs a photo of the result
def resolve_by_owner(db: Session, defect: Defect, photos: list[str]) -> None:
    if defect.item_id and not photos:
        raise ValueError("Сфотографируйте результат")
    if photos:
        defect.after_photos = photos
        defect.fixed_at = utcnow()
    accept_defect(db, defect, by_owner=True)


# Readiness numbers; progress (answered) and index (compliant) are different things
def summary(db: Session, facility: Facility) -> dict:
    session = current_session(db, facility)
    answers = answers_by_item(db, session)
    items = load_checklist()
    total = len(items)
    statuses = [answers[i["id"]].status for i in items if i["id"] in answers]
    compliant = statuses.count("compliant")
    violations = statuses.count("violation")
    na = statuses.count("na")
    applicable = total - na
    index = round(compliant / applicable * 100) if applicable else 0

    unresolved = unresolved_defects(db, facility)
    open_staff = [d for d in unresolved if d.status in ("open", "returned") and not d.to_owner]
    owner_tasks = [d for d in unresolved if d.status in ("open", "returned") and d.to_owner]
    review = [d for d in unresolved if d.status == "fixed"]

    sections = {}
    for item in items:
        sec = sections.setdefault(item["section"], {"name": item["section"], "total": 0, "answered": 0})
        sec["total"] += 1
        if item["id"] in answers:
            sec["answered"] += 1

    return {
        "total": total,
        "answered": len(statuses),
        # Answers given by the owner (not the "not applicable" ones set in the wizard)
        "started": any(a.source != "features" for a in answers.values()),
        "progress": round(len(statuses) / total * 100) if total else 0,
        "compliant": compliant,
        "violations": violations,
        "na": na,
        "applicable": applicable,
        "index": index,
        "open_staff": len(open_staff),
        "owner_tasks": len(owner_tasks),
        "review": len(review),
        "unresolved": len(unresolved),
        "ready": index >= READY_INDEX_PERCENT and not unresolved,
        "sections": list(sections.values()),
        "started_at": format_local_datetime(session.created_at),
        "finished_at": format_local_datetime(session.finished_at),
        "finished": session.finished_at is not None,
    }


# "As it should be" photo: the facility's own first, then the product library
def reference_photo_url(facility: Facility, item_id: int | None) -> str | None:
    if not item_id:
        return None
    own = facility.reference_photos.get(str(item_id))
    if own and local_photo_path(own):
        return own
    item = get_item(item_id)
    library = item.get("reference_photo") if item else None
    if library and (FRONTEND_DIR / library).exists():
        return "/" + library
    return None


# Local file behind a photo URL (/uploads/... or a frontend library image)
def local_photo_path(url: str | None):
    if not url:
        return None
    if url.startswith("/uploads/"):
        base, rel = UPLOADS_DIR, url.removeprefix("/uploads/")
    else:
        base, rel = FRONTEND_DIR, url.lstrip("/")
    path = (base / rel).resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        return None
    return path


def defect_to_dict(defect: Defect, facility: Facility) -> dict:
    item = get_item(defect.item_id) if defect.item_id else {}
    item = item or {}
    return {
        "id": defect.id,
        "item_id": defect.item_id,
        "kind": defect.kind,
        "title": defect.title,
        "comment": defect.comment,
        "zone": item.get("zone") or item.get("section") or "",
        "violation": item.get("violation", ""),
        "remediation": item.get("remediation", ""),
        "norm": item.get("norm", ""),
        "basis": item.get("basis", ""),
        "checklist_ref": item.get("checklist_ref", ""),
        "article": item.get("article", ""),
        "fines": item.get("fines"),
        "photo_hint": item.get("photo_hint", ""),
        "shift_item": bool(item) and is_shift_item(item),
        "status": defect.status,
        "assigned_position": defect.assigned_position,
        "to_owner": bool(defect.to_owner),
        "before_photos": defect.before_photos,
        "after_photos": defect.after_photos,
        "reference_photo": reference_photo_url(facility, defect.item_id),
        "return_reason": defect.return_reason,
        "fixed_by": defect.fixed_by.full_name if defect.fixed_by else None,
        "created_at": format_local_datetime(defect.created_at),
        "fixed_at": format_local_datetime(defect.fixed_at),
    }
