# runtime/storage.py
from __future__ import annotations
from collections import defaultdict
from typing import Any, Dict, List, Optional

class ObjectStore:
    """Central storage for all model instances"""
    _store: Dict[str, Dict[str, Any]] = defaultdict(dict)  # { classname: {id: instance} }

    @classmethod
    def register(cls, class_name: str):
        """Register a class type in the store"""
        cls._store.setdefault(class_name, {})

    @classmethod
    def create(cls, class_name: str, id: str, instance: Any):
        """Store an instance"""
        cls._store[class_name][id] = instance

    @classmethod
    def find(cls, class_name: str, id: str) -> Optional[Any]:
        """Find instance by class name and id"""
        return cls._store[class_name].get(id)

    @classmethod
    def select_all(cls, class_name: str) -> List[Any]:
        """Select all instances of a class"""
        return list(cls._store[class_name].values())
    
    @classmethod
    def select_any(cls, class_name: str) -> Optional[Any]:
        """Select any one instance of a class"""
        instances = cls.select_all(class_name)
        return instances[0] if instances else None

    @classmethod
    def delete(cls, class_name: str, id: str):
        """Delete an instance"""
        if id in cls._store[class_name]:
            del cls._store[class_name][id]
    
    @classmethod
    def clear(cls, class_name: Optional[str] = None):
        """Clear all instances or instances of specific class"""
        if class_name:
            cls._store[class_name] = {}
        else:
            cls._store = defaultdict(dict)
    
    @classmethod
    def count(cls, class_name: str) -> int:
        """Count instances of a class"""
        return len(cls._store[class_name])
