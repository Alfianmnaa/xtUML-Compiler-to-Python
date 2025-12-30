# models/VendingMachine.py
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

class VendingMachine(InstanceBase):
    """xtUML Class: VendingMachine (VM)"""
    kl = "VM"

    def __init__(self, id: Optional[str] = None):
        if id is None:
            id = str(uuid.uuid4())
        super().__init__(id, "VM")
        self.set_attr('currentState', "Idle")  # string
        self.set_attr('R1_selectedProduct', None)  # inst_ref<Product>
        self.set_attr('R3_transaction', None)  # inst_ref<Transaction>
        ObjectStore.register("VendingMachine")
        ObjectStore.create("VendingMachine", self._id, self)
        self._build_state_machine()

    def handleSelection(self, p_productCode: str = '', **kwargs):
        """Operation: handleSelection(p_productCode: string)"""
        print(f"[{self.kl}:{self._id}] OPERATION: handleSelection")
        kwargs['p_productCode'] = p_productCode
        pass

    def initiatePayment(self, **kwargs):
        """Operation: initiatePayment()"""
        print(f"[{self.kl}:{self._id}] OPERATION: initiatePayment")
        pass

    def verifyPayment(self, **kwargs):
        """Operation: verifyPayment()"""
        print(f"[{self.kl}:{self._id}] OPERATION: verifyPayment")
        pass

    def dispenseItem(self, **kwargs):
        """Operation: dispenseItem()"""
        print(f"[{self.kl}:{self._id}] OPERATION: dispenseItem")
        pass

    def cancelOrder(self, **kwargs):
        """Operation: cancelOrder()"""
        print(f"[{self.kl}:{self._id}] OPERATION: cancelOrder")
        pass

    def handleError(self, **kwargs):
        """Operation: handleError()"""
        print(f"[{self.kl}:{self._id}] OPERATION: handleError")
        pass

    def _sm_action_Idle_ProductSelected(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for Idle -> CheckStock via ProductSelected"""
        # Event parameters: p_productCode: string
        from runtime.base import RuntimeServices
        # [Instance Selection] select any p from instances of PRD where (selected.productCode == rcvd_evt.p_productCode);
        p_list = [candidate for candidate in ObjectStore.select_all(_KL_MAP.get("PRD", "PRD")) if candidate.get_attr('productCode') == payload.get('p_productCode')]
        p = p_list[0] if p_list else None
        if p is not None:
            relate("R1", owner, p)
            if p.get_attr('stock') > 0:
                #  Stock tersedia, lanjut ke inisiasi pembayaran
                # [Event Generation] PaymentInitiated to self
                if owner and hasattr(owner, 'sm'):
                    owner.sm.state = 'PaymentInitiated'
                    owner.set_attr('currentState', 'PaymentInitiated')
                if owner and hasattr(owner, 'sm'):
                    owner.sm.dispatch("PaymentInitiated", {})
            else:
                #  Stock kosong, alihkan ke state CheckStock (next_state default)
                # [Event Generation] StockEmpty to self
                if owner and hasattr(owner, 'sm'):
                    owner.sm.state = 'CheckStock'
                    owner.set_attr('currentState', 'CheckStock')
                if owner and hasattr(owner, 'sm'):
                    owner.sm.dispatch("StockEmpty", {})
        else:
            #  Produk tidak ditemukan
            # [Relationship Navigation] select one ui related by self->UI[R2];
            ui_list = select_related("R2", owner)
            ui = ui_list[0] if ui_list else None
            if ui is not None:
                # [Operation Call] ui.showError(error_msg:"Product not found");
                if hasattr(ui, 'showError'): ui.showError(error_msg="Product not found")
            #  Kembali ke Idle setelah error
            # [Event Generation] Reset to self
            if owner and hasattr(owner, 'sm'):
                owner.sm.state = 'OutOfStock'
                owner.set_attr('currentState', 'OutOfStock')
            if owner and hasattr(owner, 'sm'):
                owner.sm.dispatch("Reset", {})

    def _sm_action_CheckStock_StockEmpty(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for CheckStock -> OutOfStock via StockEmpty"""
        from runtime.base import RuntimeServices
        # [Relationship Navigation] select one ui related by self->UI[R2];
        ui_list = select_related("R2", owner)
        ui = ui_list[0] if ui_list else None
        if ui is not None:
            # [Operation Call] ui.showMessage(message:"Out of stock. Please select another item.");
            if hasattr(ui, 'showMessage'): ui.showMessage(message="Out of stock. Please select another item.")

    def _sm_action_PaymentInitiated_PaymentInitiated(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for PaymentInitiated -> WaitingPayment via PaymentInitiated"""
        from runtime.base import RuntimeServices
        _cls_t = _get_class_by_kl("TXN")
        t = _cls_t._create_instance()
        print(f"[OAL] Created {t.kl}:{t._id}")
        # [Relationship Navigation] select one p related by self->PRD[R1];
        p_list = select_related("R1", owner)
        p = p_list[0] if p_list else None
        #  Pastikan produk dipilih
        if p is not None:
            t.set_attr('amount', p.get_attr('price'))
            t.set_attr('status', "Pending")
            relate("R3", owner, t)
            #  Bridge Call: Initiate QR creation (PS is External Entity)
            # [Bridge/Function Call] PS::createQR(t_instance:t);
            try:
                PS.createQR(t_instance=t)
            except NameError: print(f"[OAL] External Entity PS not loaded.")
            #  Optionally show QR on UI
            # [Relationship Navigation] select one ui related by self->UI[R2];
            ui_list = select_related("R2", owner)
            ui = ui_list[0] if ui_list else None
            if ui is not None:
                # [Operation Call] ui.showQR();
                if hasattr(ui, 'showQR'): ui.showQR()
        else:
            #  Error: Product lost or unselected
            # [Event Generation] Reset to self
            if owner and hasattr(owner, 'sm'):
                owner.sm.state = 'OutOfStock'
                owner.set_attr('currentState', 'OutOfStock')
            if owner and hasattr(owner, 'sm'):
                owner.sm.dispatch("Reset", {})

    def _sm_action_WaitingPayment_PaymentSuccess(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for WaitingPayment -> Dispensing via PaymentSuccess"""
        from runtime.base import RuntimeServices
        #  On successful payment, mark transaction, reduce stock, and dispense */
        # [Relationship Navigation] select one t related by self->TXN[R3];
        t_list = select_related("R3", owner)
        t = t_list[0] if t_list else None
        if t is not None:
            t.set_attr('status', "Completed")
        #  Activate Dispenser (DSP is External Entity, langsung panggil bridge)
        # [Bridge/Function Call] DSP::activateMotor();
        try:
            DSP.activateMotor()
        except NameError: print(f"[OAL] External Entity DSP not loaded.")
        # [Event Generation] ItemDispensed to self
        if owner and hasattr(owner, 'sm'):
            owner.sm.state = 'Dispensing'
            owner.set_attr('currentState', 'Dispensing')
        if owner and hasattr(owner, 'sm'):
            owner.sm.dispatch("ItemDispensed", {})

    def _sm_action_WaitingPayment_Failed_PaymentFailed(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for WaitingPayment_Failed -> Error via PaymentFailed"""
        from runtime.base import RuntimeServices
        # [Relationship Navigation] select one ui related by self->UI[R2];
        ui_list = select_related("R2", owner)
        ui = ui_list[0] if ui_list else None
        if ui is not None:
            # [Operation Call] ui.showError(error_msg:"Payment failed. Transaction canceled.");
            if hasattr(ui, 'showError'): ui.showError(error_msg="Payment failed. Transaction canceled.")
        # [Relationship Navigation] select one t related by self->TXN[R3];
        t_list = select_related("R3", owner)
        t = t_list[0] if t_list else None
        if t is not None:
            unrelate("R3", owner, t)
            if t: ObjectStore.delete(type(t).__name__, t._id)
        #  Unrelate product selection (R1) as well
        # [Unrelate Navigation] unrelate self from self->PRD[R1] across R1;
        owner_rel_tmp_list = select_related("R1", owner)
        owner_rel_tmp = owner_rel_tmp_list[0] if owner_rel_tmp_list else None
        if owner_rel_tmp is not None: unrelate("R1", owner, owner_rel_tmp)
        # [Event Generation] Reset to self
        if owner and hasattr(owner, 'sm'):
            owner.sm.state = 'OutOfStock'
            owner.set_attr('currentState', 'OutOfStock')
        if owner and hasattr(owner, 'sm'):
            owner.sm.dispatch("Reset", {})

    def _sm_action_Dispensing_ItemDispensed(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for Dispensing -> Idle via ItemDispensed"""
        from runtime.base import RuntimeServices
        #  1. Update stock (local attribute & external service)
        # [Relationship Navigation] select one p related by self->PRD[R1];
        p_list = select_related("R1", owner)
        p = p_list[0] if p_list else None
        if p is not None:
            #  Hitung dan simpan nilai baru dalam variabel lokal (kepatuhan OAL)
            new_stock = p.get_attr('stock') - 1
            product_code = p.get_attr('productCode')
            #  Update local stock
            p.set_attr('stock', new_stock)
            #  Update external inventory (IS is External Entity)
            # [Bridge/Function Call] IS::updateStock(productCode: product_code, newStock: new_stock);
            try:
                IS.updateStock(productCode=product_code, newStock=new_stock)
            except NameError: print(f"[OAL] External Entity IS not loaded.")
            #  Optionally notify UI
            # [Relationship Navigation] select one ui related by self->UI[R2];
            ui_list = select_related("R2", owner)
            ui = ui_list[0] if ui_list else None
            if ui is not None:
                # [Operation Call] ui.showMessage(message:"Item dispensed. Thank you!");
                if hasattr(ui, 'showMessage'): ui.showMessage(message="Item dispensed. Thank you!")
        #  2. Clean up transaction (Hapus TXN dan R3)
        # [Relationship Navigation] select one t related by self->TXN[R3];
        t_list = select_related("R3", owner)
        t = t_list[0] if t_list else None
        if t is not None:
            unrelate("R3", owner, t)
            if t: ObjectStore.delete(type(t).__name__, t._id)
        #  3. Clean up product selection (Hapus R1)
        unrelate("R1", owner, p)

    def _sm_action_OutOfStock_Reset(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for OutOfStock -> Idle via Reset"""
        from runtime.base import RuntimeServices
        # [Relationship Navigation] select one ui related by self->UI[R2];
        ui_list = select_related("R2", owner)
        ui = ui_list[0] if ui_list else None
        if ui is not None:
            # [Operation Call] ui.showMessage(message:"System ready for next order.");
            if hasattr(ui, 'showMessage'): ui.showMessage(message="System ready for next order.")
        # [Unrelate Navigation] unrelate self from self->PRD[R1] across R1; // Hapus referensi produk yang gagal
        owner_rel_tmp_list = select_related("R1", owner)
        owner_rel_tmp = owner_rel_tmp_list[0] if owner_rel_tmp_list else None
        if owner_rel_tmp is not None: unrelate("R1", owner, owner_rel_tmp)

    def _sm_action_Error_Reset(self, owner: 'VendingMachine', payload: Dict[str, Any]):
        """State action for Error -> Idle via Reset"""
        from runtime.base import RuntimeServices
        # [Relationship Navigation] select one ui related by self->UI[R2];
        ui_list = select_related("R2", owner)
        ui = ui_list[0] if ui_list else None
        if ui is not None:
            # [Operation Call] ui.showMessage(message:"Initializing system. Ready.");
            if hasattr(ui, 'showMessage'): ui.showMessage(message="Initializing system. Ready.")
        #  Ensure all references are cleared (R1 and R3 if they exist)
        # [Unrelate Navigation] unrelate self from self->PRD[R1] across R1;
        owner_rel_tmp_list = select_related("R1", owner)
        owner_rel_tmp = owner_rel_tmp_list[0] if owner_rel_tmp_list else None
        if owner_rel_tmp is not None: unrelate("R1", owner, owner_rel_tmp)
        # [Unrelate Navigation] unrelate self from self->TXN[R3] across R3;
        owner_rel_tmp_list = select_related("R3", owner)
        owner_rel_tmp = owner_rel_tmp_list[0] if owner_rel_tmp_list else None
        if owner_rel_tmp is not None: unrelate("R3", owner, owner_rel_tmp)

    def _build_sm_table(self) -> Dict:
        """Build state machine transition table"""
        table: Dict = {}
        table.setdefault('Idle', {})['ProductSelected'] = (None, self._sm_action_Idle_ProductSelected, 'CheckStock')
        table.setdefault('CheckStock', {})['StockEmpty'] = (None, self._sm_action_CheckStock_StockEmpty, 'OutOfStock')
        table.setdefault('PaymentInitiated', {})['PaymentInitiated'] = (None, self._sm_action_PaymentInitiated_PaymentInitiated, 'WaitingPayment')
        table.setdefault('WaitingPayment', {})['PaymentSuccess'] = (None, self._sm_action_WaitingPayment_PaymentSuccess, 'Dispensing')
        table.setdefault('WaitingPayment_Failed', {})['PaymentFailed'] = (None, self._sm_action_WaitingPayment_Failed_PaymentFailed, 'Error')
        table.setdefault('Dispensing', {})['ItemDispensed'] = (None, self._sm_action_Dispensing_ItemDispensed, 'Idle')
        table.setdefault('OutOfStock', {})['Reset'] = (None, self._sm_action_OutOfStock_Reset, 'Idle')
        table.setdefault('Error', {})['Reset'] = (None, self._sm_action_Error_Reset, 'Idle')
        table.setdefault('WaitingPayment', {})['PaymentFailed'] = (None, self._sm_action_WaitingPayment_Failed_PaymentFailed, 'Error')
        return table

    def _build_state_machine(self):
        """Initialize state machine"""
        initial_state = self.get_attr('currentState') or 'Idle'
        self.sm = StateMachine(self, initial_state, self._build_sm_table())

    def dispatch_event(self, event_name: str, **payload) -> bool:
        """Dispatch an event to this instance's state machine"""
        if hasattr(self, 'sm'):
            return self.sm.dispatch(event_name, payload)
        return False
