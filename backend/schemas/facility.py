from pydantic import BaseModel


class StaffItem(BaseModel):
    full_name: str
    position: str


class FacilityUpdateRequest(BaseModel):
    name: str | None = None
    address: str | None = None
    geo_lat: float | None = None
    geo_lon: float | None = None
    geo_required: bool = True
    admin_pin: str | None = None
    staff_count: int = 0
    positions: list = []
    duties: list = []
    staff_list: list[StaffItem] = []


class FacilityAuthRequest(BaseModel):
    code: str
    admin_pin: str


class AddStaffRequest(BaseModel):
    full_name: str
    position: str


class FacilityAuditRequest(BaseModel):
    audit_answers: dict = {}
    audit_progress: int = 0


class DefectNotifyRequest(BaseModel):
    duty_id: int
    title: str
    violation: str
    remediation: str
    assigned_role: str | None = None
    reporter_name: str | None = "Контролер / Руководитель"


