from pydantic import BaseModel, Field


class NewStaff(BaseModel):
    full_name: str = Field(max_length=120)
    position: str = Field(max_length=60)


class CustomDuty(BaseModel):
    question: str = Field(max_length=200)
    position: str = Field(max_length=60)


# Setup wizard, sent once at "Готово" (and again when editing settings)
class SetupRequest(BaseModel):
    name: str = Field(max_length=120)
    address: str | None = Field(default=None, max_length=300)
    qr_checkin: bool = False
    positions: list[str] = []
    features: list[str] = []
    assignments: dict[str, str] = {}
    custom_duties: list[CustomDuty] = []
    new_staff: list[NewStaff] = []
    owner_works_shift: bool = False
    owner_name: str | None = Field(default=None, max_length=120)


# Owner switches their own shift role on or off
class ShiftRoleRequest(BaseModel):
    works: bool
    name: str | None = Field(default=None, max_length=120)


# Work rules from the settings screen; only the fields sent are changed
class SettingsRequest(BaseModel):
    qr_checkin: bool | None = None
    compliant_photo_required: bool | None = None
    task_photo_required: bool | None = None
    reference_from_fixes: bool | None = None


class StaffUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    position: str | None = Field(default=None, max_length=60)


class AnswerRequest(BaseModel):
    # "compliant" | "violation" | "na"
    status: str
    photos: list[str] = Field(default=[], max_length=10)
    # Position name, "owner", or empty for the default assignment
    assign_to: str | None = None


class DefectReturnRequest(BaseModel):
    reason: str = Field(max_length=200)


class DefectResolveRequest(BaseModel):
    photos: list[str] = Field(default=[], max_length=10)


class DefectFixRequest(BaseModel):
    photos: list[str] = Field(default=[], max_length=10)


class TaskRequest(BaseModel):
    done: bool
    photos: list[str] = Field(default=[], max_length=10)


class StartShiftRequest(BaseModel):
    # Text of the scanned "Начало смены" QR
    code: str | None = Field(default=None, max_length=300)


class EndShiftRequest(BaseModel):
    force: bool = False


class ProblemRequest(BaseModel):
    text: str = Field(min_length=3, max_length=500)
    photos: list[str] = Field(default=[], max_length=10)
