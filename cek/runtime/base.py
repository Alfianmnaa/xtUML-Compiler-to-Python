# runtime/base.py
from __future__ import annotations
import time
import threading
import uuid
from typing import Any, Dict, List, Optional, TYPE_CHECKING

class EventInstance:
    """Represents an OAL event with payload data"""
    def __init__(self, name: str, target: Any, payload: Optional[Dict] = None):
        self.name = name
        self.target = target
        self.payload = payload or {}
        self.timestamp = time.time()
    
    def __repr__(self):
        return f"<Event:{self.name} -> {self.target}>"

class RuntimeServices:
    """Core runtime services for OAL simulation"""
    _timers: Dict[str, threading.Timer] = {} 
    _current_time: float = time.time()
    _message_bus: List[Dict] = []

    @classmethod
    def send_message(cls, target: str, message: str, payload: Dict):
        """Send inter-component message"""
        print(f"[MSG] Sending {message} to {target} with {payload}")
        cls._message_bus.append({'to': target, 'msg': message, 'data': payload})
    
    @classmethod
    def create_timer(cls, instance: Any, duration: float, event_name: str) -> str:
        """Create a timer that dispatches event after duration"""
        timer_id = str(uuid.uuid4())
        def callback():
            print(f"[TIMER] Expired. Dispatching {event_name} to {instance.kl}")
            if hasattr(instance, 'sm'):
                instance.sm.dispatch(event_name, {})
            if timer_id in cls._timers:
                del cls._timers[timer_id]

        t = threading.Timer(float(duration), callback)
        t.start()
        cls._timers[timer_id] = t
        return timer_id
    
    @classmethod
    def cancel_timer(cls, timer_id: str):
        """Cancel an existing timer"""
        if timer_id in cls._timers:
            cls._timers[timer_id].cancel()
            del cls._timers[timer_id]
        
    @classmethod
    def current_date(cls) -> str:
        """Get current date in ISO format"""
        return time.strftime("%Y-%m-%d", time.localtime(cls._current_time))
    
    @classmethod
    def current_time(cls) -> str:
        """Get current time"""
        return time.strftime("%H:%M:%S", time.localtime(cls._current_time))
    
    @classmethod
    def current_timestamp(cls) -> float:
        """Get current timestamp"""
        return cls._current_time

class InstanceBase:
    """Base class for all model instances"""
    kl: str = "BASE"
    
    def __init__(self, id: str, kl: str):
        self._id = id
        self.kl = kl
        self._attrs: Dict[str, Any] = {}
        
    def __repr__(self):
        return f"<{self.kl}:{self._id}>"

    def set_attr(self, name: str, value: Any):
        """Set attribute value"""
        self._attrs[name] = value

    def get_attr(self, name: str) -> Any:
        """Get attribute value"""
        return self._attrs.get(name)
    
    @classmethod
    def _create_instance(cls, id: Optional[str] = None) -> 'InstanceBase':
        """Factory method to create new instance"""
        if id is None: 
            id = str(uuid.uuid4())
        inst = cls(id)
        return inst
