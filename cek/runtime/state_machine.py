# runtime/state_machine.py
from __future__ import annotations
from typing import Any, Callable, Dict, Optional, Tuple

class StateMachine:
    """State machine implementation for xtUML classes"""
    
    def __init__(self, owner: Any, initial_state: str, transition_table: Dict):
        self.owner = owner
        self.state = initial_state
        self.table = transition_table
        self._history: list = []
        print(f"[{owner.kl}:{owner._id}] SM Init: {self.state}")

    def dispatch(self, event: str, payload: Optional[Dict] = None) -> bool:
      """
      Dispatch an event to the state machine.
      payload contains event parameters (rcvd_evt data).
      """
      if payload is None:
        payload = {}
            
      state_transitions = self.table.get(self.state, {})
      if event in state_transitions:
        guard_fn, action_fn, next_state = state_transitions[event]
            
        # Check guard condition if exists
        if guard_fn and not guard_fn(self.owner, payload):
          print(f"[{self.owner.kl}:{self.owner._id}] Guard failed for {event}")
          return False
            
        print(f"[{self.owner.kl}:{self.owner._id}] Transition: {self.state} -> {next_state} via {event}")
            
        # Record history
        self._history.append((self.state, event, next_state))
            
        # Apply state change before action so self-generated events see the target state
        prior_state = self.state
        if next_state:
          self.state = next_state
          self.owner.set_attr('currentState', next_state)

        # Execute action with payload
        if action_fn:
          try:
            action_fn(self.owner, payload)
          except Exception as e:
            print(f"[{self.owner.kl}:{self.owner._id}] Action error: {e}")
                    
        # If action changed state, keep it; otherwise state already set to next_state
        return True
      else:
        print(f"[{self.owner.kl}] Ignored event {event} in state {self.state}")
        return False
    
    def get_current_state(self) -> str:
        """Get current state name"""
        return self.state
    
    def get_history(self) -> list:
        """Get transition history"""
        return self._history.copy()
