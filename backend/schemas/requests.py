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
    geo_required: bool = True
    positions: list[str] = []
    features: list[str] = []
    assignments: dict[str, str] = {}
    custom_duties: list[CustomDuty] = []
    new_staff: list[NewStaff] = []
    owner_works_shift: bool = False
    owner_position: str | None = None
    owner_name: str | None = Field(default=None, max_length=120)


# Owner switches the employee role on or off, or changes their own position
class ShiftRoleRequest(BaseModel):
    works: bool
    position: str | None = Field(default=None, max_length=60)
    name: str | None = Field(default=None, max_length=120)


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


class ClaimRequest(BaseModel):
    employee_id: int


class TaskRequest(BaseModel):
    done: bool
    photos: list[str] = Field(default=[], max_length=10)


class EndShiftRequest(BaseModel):
    force: bool = False


class ProblemRequest(BaseModel):
    text: str = Field(min_length=3, max_length=500)
    photos: list[str] = Field(default=[], max_length=10)
