# models/Payment.py
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

class Payment(InstanceBase):
    """xtUML Class: Payment (PAY)"""
    kl = "PAY"

    def __init__(self, id: Optional[str] = None):
        if id is None:
            id = str(uuid.uuid4())
        super().__init__(id, "PAY")
        self.set_attr('paymentId', '')  # string
        self.set_attr('qrisCode', '')  # string
        self.set_attr('amount', 0.0)  # real
        self.set_attr('status', "Waiting")  # string
        ObjectStore.register("Payment")
        ObjectStore.create("Payment", self._id, self)

    def generateQRIS(self, **kwargs):
        """Operation: generateQRIS()"""
        print(f"[{self.kl}:{self._id}] OPERATION: generateQRIS")
        pass

    def verifyQRIS(self, **kwargs):
        """Operation: verifyQRIS()"""
        print(f"[{self.kl}:{self._id}] OPERATION: verifyQRIS")
        pass
