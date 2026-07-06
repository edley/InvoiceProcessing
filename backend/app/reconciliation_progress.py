import threading
from datetime import datetime

_state = {
    "run_id": None,
    "total": 0,
    "processed": 0,
    "current_label": "",
    "status": "idle",
    "started_at": None,
    "completed_at": None,
}
_lock = threading.Lock()


def start(total: int):
    with _lock:
        _state["run_id"] = datetime.utcnow().isoformat()
        _state["total"] = total
        _state["processed"] = 0
        _state["current_label"] = ""
        _state["status"] = "running"
        _state["started_at"] = datetime.utcnow().isoformat()
        _state["completed_at"] = None


def tick(processed: int, label: str = ""):
    with _lock:
        _state["processed"] = processed
        if label:
            _state["current_label"] = label


def complete():
    with _lock:
        _state["status"] = "complete"
        _state["completed_at"] = datetime.utcnow().isoformat()
        _state["current_label"] = "Done"


def fail():
    with _lock:
        _state["status"] = "failed"


def get():
    with _lock:
        return dict(_state)
