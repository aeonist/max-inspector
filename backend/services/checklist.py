import json
from functools import lru_cache

from config import CHECKLIST_PATH

# Item types checked by the owner during the audit; they never go to shift staff
OWNER_TASK_TYPES = {"document", "infrastructure", "periodic"}
# Ids of the owner's own duties start here to never clash with checklist ids
CUSTOM_DUTY_BASE_ID = 1000


# Load the inspection checklist (JSON file shared with the frontend)
@lru_cache(maxsize=1)
def load_checklist() -> list[dict]:
    with open(CHECKLIST_PATH, encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _items_by_id() -> dict[int, dict]:
    return {item["id"]: item for item in load_checklist()}


def get_item(item_id: int) -> dict | None:
    return _items_by_id().get(item_id)


def all_item_ids() -> list[int]:
    return [item["id"] for item in load_checklist()]


def is_shift_item(item: dict) -> bool:
    return item.get("task_type", "shift") == "shift"


# Conditional item that does not apply to this facility per the setup wizard
def is_not_applicable(item: dict, features: list[str]) -> bool:
    condition = item.get("applies_to")
    return bool(condition) and condition not in features


# Default shift duty assignment for a set of positions
def default_assignments(positions: list[str]) -> dict[str, str]:
    result = {}
    for item in load_checklist():
        if not is_shift_item(item):
            continue
        role = item.get("default_role")
        if role in positions:
            result[str(item["id"])] = role
        elif positions:
            result[str(item["id"])] = positions[0]
    return result


# Label of the owner's own staff profile: the owner may take any duty of the shift
OWNER_POSITION = "Руководитель"


# Shift duties of a position (all positions when None): checklist items plus the owner's own duties
def duties_for_position(facility, position: str | None) -> list[dict]:
    assignments = facility.assignments
    features = facility.features
    duties = []
    for item in load_checklist():
        if not is_shift_item(item) or is_not_applicable(item, features):
            continue
        assigned = assignments.get(str(item["id"]))
        if position is None or assigned == position:
            duties.append(
                {
                    "id": item["id"],
                    "position": assigned,
                    "zone": item.get("zone") or item.get("section"),
                    "question": item["question"],
                    "norm": item.get("norm", ""),
                    "photo_hint": item.get("photo_hint") or "",
                    "custom": False,
                }
            )
    for duty in facility.custom_duties:
        if position is None or duty.get("position") == position:
            duties.append(
                {
                    "id": duty["id"],
                    "position": duty.get("position"),
                    "zone": "Свои задачи",
                    "question": duty["question"],
                    "norm": "",
                    "photo_hint": "",
                    "custom": True,
                }
            )
    return duties


# The owner on shift sees every duty; staff see their position's
def duties_for_employee(employee) -> list[dict]:
    return duties_for_position(employee.facility, None if employee.is_owner else employee.position)
