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
