# runtime/relationship.py
from __future__ import annotations
from typing import Any, Dict, List, Tuple, Optional

# Global relationship storage
_LINKS: Dict[str, List[Tuple[Any, Any]]] = {}

def relate(rel_id: str, inst1: Any, inst2: Any) -> bool:
    """Create a relationship link between two instances"""
    if inst1 is None or inst2 is None:
        print(f"[RELATE] Warning: Cannot relate None instances across {rel_id}")
        return False
        
    link = (inst1, inst2)
    if link not in _LINKS.setdefault(rel_id, []):
        _LINKS[rel_id].append(link)
        print(f"[RELATE] {inst1.kl}:{inst1._id} linked to {inst2.kl}:{inst2._id} across {rel_id}")
        return True
    return False

def unrelate(rel_id: str, inst1: Any, inst2: Any) -> bool:
    """Remove a relationship link between two instances"""
    if inst1 is None or inst2 is None:
        return False
        
    link = (inst1, inst2)
    reverse_link = (inst2, inst1)
    
    if rel_id in _LINKS:
        if link in _LINKS[rel_id]:
            _LINKS[rel_id].remove(link)
            print(f"[UNRELATE] {inst1.kl}:{inst1._id} unlinked from {inst2.kl}:{inst2._id} across {rel_id}")
            return True
        elif reverse_link in _LINKS[rel_id]:
            _LINKS[rel_id].remove(reverse_link)
            print(f"[UNRELATE] {inst2.kl}:{inst2._id} unlinked from {inst1.kl}:{inst1._id} across {rel_id}")
            return True
    return False
    
def select_related(rel_id: str, source_instance: Any) -> List[Any]:
    """Select all instances related to source across relationship"""
    if source_instance is None:
        return []
        
    results = []
    for inst1, inst2 in _LINKS.get(rel_id, []):
        if inst1._id == source_instance._id:
            results.append(inst2)
        elif inst2._id == source_instance._id:
            results.append(inst1)
    return results

def select_one_related(rel_id: str, source_instance: Any) -> Optional[Any]:
    """Select one instance related to source across relationship"""
    related = select_related(rel_id, source_instance)
    return related[0] if related else None

def is_related(rel_id: str, inst1: Any, inst2: Any) -> bool:
    """Check if two instances are related"""
    if inst1 is None or inst2 is None:
        return False
    link = (inst1, inst2)
    reverse = (inst2, inst1)
    links = _LINKS.get(rel_id, [])
    return link in links or reverse in links

def clear_relationships(rel_id: Optional[str] = None):
    """Clear all relationships or specific relationship"""
    global _LINKS
    if rel_id:
        _LINKS[rel_id] = []
    else:
        _LINKS = {}
