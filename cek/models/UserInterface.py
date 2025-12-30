# models/UserInterface.py
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

class UserInterface(InstanceBase):
    """xtUML Class: UserInterface (UI)"""
    kl = "UI"

    def __init__(self, id: Optional[str] = None):
        if id is None:
            id = str(uuid.uuid4())
        super().__init__(id, "UI")
        self.set_attr('displayStatus', '')  # string
        ObjectStore.register("UserInterface")
        ObjectStore.create("UserInterface", self._id, self)

    def displayScreen(self, **kwargs):
        """Operation: displayScreen()"""
        print(f"[{self.kl}:{self._id}] OPERATION: displayScreen")
        pass

    def receiveInput(self, **kwargs):
        """Operation: receiveInput()"""
        print(f"[{self.kl}:{self._id}] OPERATION: receiveInput")
        pass

    def showQR(self, **kwargs):
        """Operation: showQR()"""
        print(f"[{self.kl}:{self._id}] OPERATION: showQR")
        pass

    def showMessage(self, message: str = '', **kwargs):
        """Operation: showMessage(message: string)"""
        print(f"[{self.kl}:{self._id}] OPERATION: showMessage")
        kwargs['message'] = message
        pass

    def showError(self, error_msg: str = '', **kwargs):
        """Operation: showError(error_msg: string)"""
        print(f"[{self.kl}:{self._id}] OPERATION: showError")
        kwargs['error_msg'] = error_msg
        pass
