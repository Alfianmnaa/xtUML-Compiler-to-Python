# models/Product.py
from __future__ import annotations
import uuid
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from runtime.base import InstanceBase, RuntimeServices, EventInstance
from runtime.state_machine import StateMachine
from runtime.storage import ObjectStore
from runtime.relationship import relate, unrelate, select_related, select_one_related

# Lazy import helper to avoid circular dependencies
def _get_class(name: str):
    """Get class by name with lazy import"""
    import importlib
    module = importlib.import_module(f'models.{name}')
    return getattr(module, name)

# KeyLetter to ClassName mapping
_KL_MAP = {
    'PRD': 'Product',
    'VM': 'VendingMachine',
    'UI': 'UserInterface',
    'TXN': 'Transaction',
    'PAY': 'Payment',
    'PS': 'PaymentService',
    'IS': 'InventoryService',
    'DSP': 'Dispenser',
}

def _get_class_by_kl(kl: str):
    """Get class by KeyLetter"""
    class_name = _KL_MAP.get(kl, kl)
    return _get_class(class_name)

class Product(InstanceBase):
    """xtUML Class: Product (PRD)"""
    kl = "PRD"

    def __init__(self, id: Optional[str] = None):
        if id is None:
            id = str(uuid.uuid4())
        super().__init__(id, "PRD")
        self.set_attr('productCode', '')  # string
        self.set_attr('name', '')  # string
        self.set_attr('price', 0.0)  # real
        self.set_attr('stock', 0)  # integer
        ObjectStore.register("Product")
        ObjectStore.create("Product", self._id, self)

    def checkStock(self, **kwargs):
        """Operation: checkStock()"""
        print(f"[{self.kl}:{self._id}] OPERATION: checkStock")
        pass

    def reduceStock(self, **kwargs):
        """Operation: reduceStock()"""
        print(f"[{self.kl}:{self._id}] OPERATION: reduceStock")
        pass
