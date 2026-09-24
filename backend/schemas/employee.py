from pydantic import BaseModel


class EmployeeRegisterRequest(BaseModel):
    code: str
    user_id: int
    full_name: str
    position: str


class EmployeeClaimRequest(BaseModel):
    code: str
    employee_id: int
    user_id: int


class EmployeeTasksRequest(BaseModel):
    completed_task_ids: list[int] = []
    task_photos: dict = {}
