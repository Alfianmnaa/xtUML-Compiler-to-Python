// compiler/codegen.js
import { escapePythonString, escapePythonValue, getDefaultValue, mapOalTypeToPython, parseOalParameters } from "./utils.js";

// --- OAL EXPRESSION TRANSLATOR ---

function translateExpression(expr, contextType) {
  if (!expr) return "";
  let pyExpr = expr;

  // [KOMPONEN: Date/Time Constants]
  pyExpr = pyExpr.replace(/\bCurrentTimeStamp\b/gi, "RuntimeServices.current_timestamp()")
                 .replace(/\bCurrentTimestamp\b/gi, "RuntimeServices.current_timestamp()")
                 .replace(/\bCurrentTime\b/gi, "RuntimeServices.current_timestamp()")
                 .replace(/\bCurrentDate\b/gi, "RuntimeServices.current_date()");

  // [KOMPONEN: Duration Literals] e.g., "8 hours" -> 8 * 3600 seconds
  pyExpr = pyExpr.replace(/(\d+(?:\.\d+)?)\s*(hours?|hour|minutes?|minute|secs?|sec|seconds?|days?|day)/gi, (m, val, unit) => {
    const mul = {
      hour: 3600, hours: 3600,
      minute: 60, minutes: 60,
      sec: 1, secs: 1, second: 1, seconds: 1,
      day: 86400, days: 86400,
    }[unit.toLowerCase()];
    if (!mul) return m;
    return `(${val} * ${mul})`;
  });

  // [KOMPONEN: Unary Operators]
  pyExpr = pyExpr.replace(/not_empty\s+(\w+)/g, "$1 is not None");
  pyExpr = pyExpr.replace(/empty\s+(\w+)/g, "$1 is None");
  pyExpr = pyExpr.replace(/cardinality\s+(\w+)/g, "len($1 if $1 else [])");

  // [KOMPONEN: Accessing Event Data] - Event payload parameters
  pyExpr = pyExpr.replace(/rcvd_evt\.(\w+)/g, "payload.get('$1')");

  // [KOMPONEN: Operations/Functions Parameters]
  pyExpr = pyExpr.replace(/param\.(\w+)/g, "kwargs.get('$1')");

  // [KOMPONEN: Instance Selection by Relationship Navigation]
  pyExpr = pyExpr.replace(/selected\.(\w+)/g, "candidate.get_attr('$1')");

  // [KOMPONEN: Reading Attributes]

  // 1. Handle self.attr
  pyExpr = pyExpr.replace(/self\.(\w+)/g, "owner.get_attr('$1')");

  // 2. Handle object.attr, abaikan jika objectnya adalah variabel sistem
  pyExpr = pyExpr.replace(/([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/g, (match, obj, attr) => {
    const ignoreList = ["payload", "candidate", "ObjectStore", "RuntimeServices", "owner", "self", "kwargs", "time", "uuid", "datetime"];

    // Jika obj ada di ignore list, biarkan
    if (ignoreList.includes(obj)) return match;

    if (attr.startsWith("get_attr") || attr.startsWith("set_attr") || attr.startsWith("sm") || attr.startsWith("_")) return match;

    return `${obj}.get_attr('${attr}')`;
  });

  // [KOMPONEN: Logical Operators]
  pyExpr = pyExpr.replace(/\sAND\s/gi, " and ").replace(/\sOR\s/gi, " or ");
  pyExpr = pyExpr.replace(/\bNOT\s+/gi, "not ");

  // Hapus sisa kurung/titik koma OAL
  pyExpr = pyExpr.replace(/\);/g, "").replace(/;/g, "");

  return pyExpr;
}

// --- CORE OAL TRANSLATOR (STATEFUL) ---
function OAL_TO_PYTHON_SIMULATION(oalCode, ownerKl, ownerId, contextType, baseIndent = "        ", eventStateMap = {}) {
  if (!oalCode) return baseIndent + "pass";

  const lines = oalCode.split("\n").filter((l) => l.trim() !== "");
  const pyLines = [];

  let indentLevel = 0;
  const getIndent = () => baseIndent + "    ".repeat(indentLevel);

  pyLines.push(baseIndent + "from runtime.base import RuntimeServices");

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // 1. Skip Comments
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("#")) {
      pyLines.push(getIndent() + `# ${line.replace(/\/\//, "").replace(/\/\*/, "")}`);
      continue;
    }

    // [KOMPONEN: Control Logic]
    if (line.startsWith("if")) {
      const condition = line.match(/if\s*\((.*)\)/)?.[1] || "True";
      const pyCond = translateExpression(condition, contextType);
      pyLines.push(getIndent() + `if ${pyCond}:`);
      indentLevel++;
      continue;
    }
    if (line.startsWith("else")) {
      indentLevel = Math.max(0, indentLevel - 1);
      pyLines.push(getIndent() + "else:");
      indentLevel++;
      continue;
    }
    if (line.startsWith("elif")) {
      indentLevel = Math.max(0, indentLevel - 1);
      const condition = line.match(/elif\s*\((.*)\)/)?.[1] || "True";
      const pyCond = translateExpression(condition, contextType);
      pyLines.push(getIndent() + `elif ${pyCond}:`);
      indentLevel++;
      continue;
    }
    if (line.startsWith("end if")) {
      indentLevel = Math.max(0, indentLevel - 1);
      continue;
    }

    // Loops
    const forMatch = line.match(/for each\s+(\w+)\s+in\s+(\w+)/);
    if (forMatch) {
      pyLines.push(getIndent() + `for ${forMatch[1]} in ${forMatch[2]}:`);
      indentLevel++;
      continue;
    }
    const whileMatch = line.match(/while\s*\((.*)\)/);
    if (whileMatch) {
      const pyCond = translateExpression(whileMatch[1], contextType);
      pyLines.push(getIndent() + `while ${pyCond}:`);
      indentLevel++;
      continue;
    }

    if (line.startsWith("break")) {
      pyLines.push(getIndent() + "break");
      continue;
    }
    if (line.startsWith("continue")) {
      pyLines.push(getIndent() + "continue");
      continue;
    }
    if (line.startsWith("return")) {
      const retVal = line.match(/return\s+(.*);?/)?.[1];
      pyLines.push(getIndent() + `return ${retVal ? translateExpression(retVal, contextType) : ""}`);
      continue;
    }
    if (line.startsWith("end for") || line.startsWith("end while")) {
      indentLevel = Math.max(0, indentLevel - 1);
      continue;
    }

    // [KOMPONEN: Instance Selection]
    const selectMatch = line.match(/select\s+(any|one|many)\s+(\w+)\s+from\s+instances\s+of\s+(\w+)(?:\s+where\s+(.*))?;?/);
    if (selectMatch) {
      const [, type, varName, className, whereClause] = selectMatch;
      pyLines.push(getIndent() + `# [Instance Selection] ${line}`);

      // Use lazy class lookup for OAL class names (KeyLetters)
      let selectCmd = `ObjectStore.select_all(_KL_MAP.get("${className}", "${className}"))`;

      if (whereClause) {
        //  Bersihkan where clause dari kurung luar
        let cleanWhere = whereClause.trim();
        if (cleanWhere.startsWith("(") && cleanWhere.endsWith(");")) {
          cleanWhere = cleanWhere.slice(1, -2);
        } else if (cleanWhere.endsWith(";")) {
          cleanWhere = cleanWhere.slice(0, -1);
        }

        const pyWhere = translateExpression(cleanWhere, contextType);
        pyLines.push(getIndent() + `${varName}_list = [candidate for candidate in ${selectCmd} if ${pyWhere}]`);
      } else {
        pyLines.push(getIndent() + `${varName}_list = ${selectCmd}`);
      }

      if (type === "many") {
        pyLines.push(getIndent() + `${varName} = ${varName}_list`);
      } else {
        pyLines.push(getIndent() + `${varName} = ${varName}_list[0] if ${varName}_list else None`);
      }
      continue;
    }

    // [KOMPONEN: Relationship Navigation]
    const navMatch = line.match(/select\s+(any|one|many)\s+(\w+)\s+related\s+by\s+(\w+)->(\w+)\[([A-Za-z0-9_]+)\];?/);
    if (navMatch) {
      const [, type, varName, sourceVar, targetClass, relId] = navMatch;
      const pySource = sourceVar === "self" ? "owner" : sourceVar;

      pyLines.push(getIndent() + `# [Relationship Navigation] ${line}`);
      pyLines.push(getIndent() + `${varName}_list = select_related("${relId}", ${pySource})`);

      if (type === "many") {
        pyLines.push(getIndent() + `${varName} = ${varName}_list`);
      } else {
        pyLines.push(getIndent() + `${varName} = ${varName}_list[0] if ${varName}_list else None`);
      }
      continue;
    }

    // [KOMPONEN: Instance Creation]
    const createMatch = line.match(/create\s+object\s+instance\s+(\w+)\s+of\s+(\w+);?/);
    if (createMatch) {
      const [, varName, className] = createMatch;
      // Use lazy class lookup for OAL class names (KeyLetters)
      pyLines.push(getIndent() + `_cls_${varName} = _get_class_by_kl("${className}")`);
      pyLines.push(getIndent() + `${varName} = _cls_${varName}._create_instance()`);
      pyLines.push(getIndent() + `print(f"[OAL] Created {${varName}.kl}:{${varName}._id}")`);
      continue;
    }

    // [KOMPONEN: Instance Deletion]
    const deleteMatch = line.match(/delete\s+object\s+instance\s+(\w+);?/);
    if (deleteMatch) {
      const [, varName] = deleteMatch;
      pyLines.push(getIndent() + `if ${varName}: ObjectStore.delete(type(${varName}).__name__, ${varName}._id)`);
      continue;
    }

    // [KOMPONEN: Relate/Unrelate]
    const relateMatch = line.match(/(un)?relate\s+(\w+)\s+(?:to|from)\s+(\w+)\s+across\s+(R\w+);?/);
    if (relateMatch) {
      const isUnrelate = relateMatch[1];
      const [, , src, dst, relId] = relateMatch;
      const func = isUnrelate ? "unrelate" : "relate";
      const pySrc = src === "self" ? "owner" : src;
      const pyDst = dst === "self" ? "owner" : dst;

      pyLines.push(getIndent() + `${func}("${relId}", ${pySrc}, ${pyDst})`);
      continue;
    }

    // [KOMPONEN: Inter-Component Messaging]
    const sendMatch = line.match(/send\s+(\w+)\((.*)\)\s+to\s+(\w+);?/);
    if (sendMatch) {
      const [, msgName, params, targetComp] = sendMatch;
      let pyPayload = "{}";
      if (params.trim()) {
        const paramPairs = params.split(",").map((p) => {
          const parts = p.split(":");
          const k = parts[0].trim();
          const v = parts.slice(1).join(":").trim();
          return `'${k}': ${translateExpression(v, contextType)}`;
        });
        pyPayload = `{${paramPairs.join(", ")}}`;
      }
      pyLines.push(getIndent() + `RuntimeServices.send_message("${targetComp}", "${msgName}", ${pyPayload})`);
      continue;
    }

    // [KOMPONEN: Creating Events]
    // Syntax: create event instance <var> of <Label> to <target>;
    const createEvtMatch = line.match(/create\s+event\s+instance\s+(\w+)\s+of\s+([A-Za-z0-9_:]+)(?:\((.*)\))?\s+to\s+(.+);?/);
    if (createEvtMatch) {
      const [, varName, label, params, target] = createEvtMatch;
      const pyTarget = target === "self" ? "owner" : target;

      // Parse params manual karena formatnya mirip array
      let pyPayload = "{}";
      if (params && params.trim()) {
        const paramPairs = params.split(",").map((p) => {
          const parts = p.split(":");
          return `'${parts[0].trim()}': ${translateExpression(parts.slice(1).join(":").trim(), contextType)}`;
        });
        pyPayload = `{${paramPairs.join(", ")}}`;
      }

      const [evtKl, evtName] = label.includes(":") ? label.split(":") : ["", label];

      pyLines.push(getIndent() + `# [Create Event] ${varName}`);
      // Butuh class EventInstance di runtime/base.py
      pyLines.push(getIndent() + `${varName} = EventInstance("${evtName}", ${pyTarget}, ${pyPayload})`);
      continue;
    }

    // [KOMPONEN: Event Generation]
    const genMatch = line.match(/generate\s+(\w+):(\w+)\((.*)\)\s+to\s+(\w+);?/);
    if (genMatch) {
      const [, evtId, evtName, params, target] = genMatch;
      const pyTarget = target === "self" ? "owner" : target;

      let pyPayload = "{}";
      if (params.trim()) {
        const paramPairs = params.split(",").map((p) => {
          const parts = p.split(":");
          const k = parts[0].trim();
          const v = parts.slice(1).join(":").trim(); // Handle jika value ada titik dua
          return `'${k}': ${translateExpression(v, contextType)}`;
        });
        pyPayload = `{${paramPairs.join(", ")}}`;
      }

      pyLines.push(getIndent() + `# [Event Generation] ${evtName} to ${target}`);

      const targetState = eventStateMap ? eventStateMap[evtName] : undefined;
      if (pyTarget === "owner" && targetState) {
        pyLines.push(getIndent() + `if ${pyTarget} and hasattr(${pyTarget}, 'sm'):`);
        pyLines.push(getIndent() + `    ${pyTarget}.sm.state = '${targetState}'`);
        pyLines.push(getIndent() + `    ${pyTarget}.set_attr('currentState', '${targetState}')`);
      }

      pyLines.push(getIndent() + `if ${pyTarget} and hasattr(${pyTarget}, 'sm'):`);
      pyLines.push(getIndent() + `    ${pyTarget}.sm.dispatch("${evtName}", ${pyPayload})`);
      continue;
    }

    // [KOMPONEN: Bridges / External Entities / Functions]
    const bridgeMatch = line.match(/(\w+)::(\w+)\((.*)\);?/);
    if (bridgeMatch) {
      const [, eeName, opName, params] = bridgeMatch;
      pyLines.push(getIndent() + `# [Bridge/Function Call] ${line}`);
      const callArgs = (params || "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const parts = p.split(":");
          const k = parts[0].trim();
          const v = translateExpression(parts.slice(1).join(":").trim(), contextType);
          return parts.length > 1 ? `${k}=${v}` : `${k}`;
        })
        .join(", ");
      pyLines.push(getIndent() + `try:`);
      pyLines.push(getIndent() + `    ${eeName}.${opName}(${callArgs})`);
      pyLines.push(getIndent() + `except NameError: print(f"[OAL] External Entity ${eeName} not loaded.")`);
      continue;
    }

    // [KOMPONEN: Functions (Global)]
    const funcMatch = line.match(/(\w+)\((.*)\);?/);
    if (funcMatch && !line.includes("=") && !line.includes(".")) {
      const [, funcName, params] = funcMatch;
      // Check if it's not a keyword like 'print' or 'select' (already handled)
      const keywords = ["print", "select", "create", "delete", "relate", "unrelate", "generate", "if", "while", "for", "return"];
      if (!keywords.includes(funcName)) {
        pyLines.push(getIndent() + `# [Function Call] ${line}`);
        pyLines.push(getIndent() + `try:`);
        pyLines.push(getIndent() + `    ${funcName}()`);
        pyLines.push(getIndent() + `except NameError: print(f"[OAL] Function ${funcName} not found.")`);
        continue;
      }
    }

    // [KOMPONEN: Operations]
    const opMatch = line.match(/(\w+)\.(\w+)\((.*)\);?/);
    if (opMatch) {
      // Pastikan bukan assignment
      if (!line.includes("=")) {
        const [, obj, op, args] = opMatch;
        const pyObj = obj === "self" ? "owner" : obj;
        const callArgs = (args || "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => {
            const parts = p.split(":");
            const k = parts[0].trim();
            const v = parts.slice(1).join(":").trim();
            return parts.length > 1 ? `${k}=${translateExpression(v, contextType)}` : translateExpression(k, contextType);
          })
          .join(", ");
        pyLines.push(getIndent() + `# [Operation Call] ${line}`);
        pyLines.push(getIndent() + `if hasattr(${pyObj}, '${op}'): ${pyObj}.${op}(${callArgs})`);
        continue;
      }
    }

    // [KOMPONEN: Unrelate with navigation syntax] e.g., unrelate self from self->PRD[R1] across R1;
    const unrelateNavMatch = line.match(/unrelate\s+(\w+)\s+from\s+self->\w+\[(R\w+)\]\s+across\s+(R\w+)/);
    if (unrelateNavMatch) {
      const [, srcVar, relIdNav, relIdAcross] = unrelateNavMatch;
      const relId = relIdAcross || relIdNav;
      const pySrc = srcVar === "self" ? "owner" : srcVar;
      const tempVar = `${pySrc}_rel_tmp`;
      pyLines.push(getIndent() + `# [Unrelate Navigation] ${line}`);
      pyLines.push(getIndent() + `${tempVar}_list = select_related("${relId}", ${pySrc})`);
      pyLines.push(getIndent() + `${tempVar} = ${tempVar}_list[0] if ${tempVar}_list else None`);
      pyLines.push(getIndent() + `if ${tempVar} is not None: unrelate("${relId}", ${pySrc}, ${tempVar})`);
      continue;
    }

    // [KOMPONEN: Assignments] [Writing Attributes]
    const assignMatch = line.match(/(?:assign\s+)?(.+?)\s*=\s*(.+);/);
    if (assignMatch) {
      let [, lhs, rhs] = assignMatch;
      lhs = lhs.trim();

      const pyRhs = translateExpression(rhs.trim(), contextType);

      if (lhs.includes(".")) {
        const [obj, attr] = lhs.split(".");
        const pyObj = obj === "self" ? "owner" : obj;
        pyLines.push(getIndent() + `${pyObj}.set_attr('${attr}', ${pyRhs})`);
      } else {
        pyLines.push(getIndent() + `${lhs} = ${pyRhs}`);
      }
      continue;
    }

    // Fallback
    pyLines.push(getIndent() + `# Unparsed OAL: ${line}`);
  }

  return pyLines.join("\n");
}
// --- RUNTIME GENERATION ---

function generateRuntimeFiles(relationships, associationClasses) {
  const files = {};

  // [KOMPONEN: Data and Time, Timers, Messaging]
  files["runtime/base.py"] = `# runtime/base.py
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
`;

  // [KOMPONEN: Storage]
  files["runtime/storage.py"] = `# runtime/storage.py
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
`;

  // [KOMPONEN: State Machine]
  files["runtime/state_machine.py"] = `# runtime/state_machine.py
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
`;

  // [KOMPONEN: Relationship]
  files["runtime/relationship.py"] = `# runtime/relationship.py
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
`;

  return files;
}

// --- CLASS FILE GENERATION ---

function genClassFile(cls, allClasses, model) {
  const className = cls.name.replace(/\W/g, "");
  const lines = [];
  lines.push(`# models/${className}.py`);
  lines.push("from __future__ import annotations");
  lines.push("import uuid");
  lines.push("from typing import Any, Dict, List, Optional, TYPE_CHECKING");
  lines.push("from runtime.base import InstanceBase, RuntimeServices, EventInstance");
  lines.push("from runtime.state_machine import StateMachine");
  lines.push("from runtime.storage import ObjectStore");
  lines.push("from runtime.relationship import relate, unrelate, select_related, select_one_related");
  lines.push("");

  // Use TYPE_CHECKING to avoid circular imports
  const otherClasses = allClasses.filter((c) => c.name !== cls.name);

  // Lazy imports inside functions to avoid circular dependency
  lines.push("# Lazy import helper to avoid circular dependencies");
  lines.push("def _get_class(name: str):");
  lines.push('    """Get class by name with lazy import"""');
  lines.push("    import importlib");
  lines.push("    module = importlib.import_module(f'models.{name}')");
  lines.push("    return getattr(module, name)");
  lines.push("");

  // Create KeyLetter mapping
  lines.push("# KeyLetter to ClassName mapping");
  lines.push("_KL_MAP = {");
  for (const otherCls of allClasses) {
    const otherClsName = otherCls.name.replace(/\W/g, "");
    if (otherCls.kl) {
      lines.push(`    '${otherCls.kl}': '${otherClsName}',`);
    }
  }
  lines.push("}");
  lines.push("");

  lines.push("def _get_class_by_kl(kl: str):");
  lines.push('    """Get class by KeyLetter"""');
  lines.push("    class_name = _KL_MAP.get(kl, kl)");
  lines.push("    return _get_class(class_name)");
  lines.push("");

  // State transition helpers
  const transitions = (cls.stateMachine?.transitions || []).map((t) => ({ ...t }));
  const eventStateMap = {};
  transitions.forEach((t) => {
    if (!eventStateMap[t.event]) eventStateMap[t.event] = t.from;
  });

  // Class definition
  lines.push(`class ${className}(InstanceBase):`);
  lines.push(`    """xtUML Class: ${cls.name} (${cls.kl})"""`);
  lines.push(`    kl = "${cls.kl}"`);
  lines.push("");

  // Constructor with typed attributes
  lines.push("    def __init__(self, id: Optional[str] = None):");
  lines.push("        if id is None:");
  lines.push("            id = str(uuid.uuid4())");
  lines.push(`        super().__init__(id, "${cls.kl}")`);

  // Initialize attributes with proper default values based on OAL types
  for (const a of cls.attributes || []) {
    const defaultVal = getDefaultValue(a.dataType, a.defaultValue);
    lines.push(`        self.set_attr('${a.name}', ${defaultVal})  # ${a.dataType || "any"}`);
  }

  lines.push(`        ObjectStore.register("${className}")`);
  lines.push(`        ObjectStore.create("${className}", self._id, self)`);
  if (cls.stateMachine) lines.push("        self._build_state_machine()");
  lines.push("");

  // [KOMPONEN: Operations] with typed parameters
  for (const op of cls.operations || []) {
    const signature = op.signature || op.name || String(op);
    const match = signature.match(/(\w+)\((.*)\)/);
    const opName = match ? match[1] : signature.replace(/\W/g, "");
    const params = op.parameters || [];

    // Build parameter signature
    let paramSig = "self";
    for (const p of params) {
      paramSig += `, ${p.name}: ${p.pythonType || "Any"} = ${p.default || "None"}`;
    }
    paramSig += ", **kwargs";

    lines.push(`    def ${opName}(${paramSig}):`);
    lines.push(`        """Operation: ${signature}"""`);
    lines.push(`        print(f"[{self.kl}:{self._id}] OPERATION: ${opName}")`);

    // Add parameters to kwargs for OAL param.xxx access
    for (const p of params) {
      lines.push(`        kwargs['${p.name}'] = ${p.name}`);
    }

    if (op.action) {
      // [KOMPONEN: OAL for Non-State Actions]
      const pyOpCode = OAL_TO_PYTHON_SIMULATION(op.action, cls.kl, "self._id", "OPERATION", "        ", eventStateMap);
      lines.push(pyOpCode);
    } else {
      lines.push("        pass");
    }
    lines.push("");
  }

  // State Machine
  if (cls.stateMachine) {
    // Generate unique action methods for each transition
    const transitionActionMap = new Map(); // Map action signature to method name
    const actionTransitions = transitions;

    for (const t of actionTransitions) {
      if (!t.actionOAL) continue;

      // Create unique key for action
      const actionKey = `${t.from}_${t.event}`;
      const actionMethodName = `_sm_action_${actionKey}`.replace(/\W/g, "_");

      if (!transitionActionMap.has(actionKey)) {
        transitionActionMap.set(actionKey, actionMethodName);
        t.actionMethodName = actionMethodName;

        // Get event parameters for this event
        const eventParams = t.eventParameters || [];

        lines.push(`    def ${actionMethodName}(self, owner: '${className}', payload: Dict[str, Any]):`);
        lines.push(`        """State action for ${t.from} -> ${t.to} via ${t.event}"""`);

        // Document expected payload parameters
        if (eventParams.length > 0) {
          lines.push(`        # Event parameters: ${eventParams.map((p) => `${p.name}: ${p.oalType || "any"}`).join(", ")}`);
        }

        // Translate OAL
        const pyActionCode = OAL_TO_PYTHON_SIMULATION(t.actionOAL, cls.kl, "owner._id", "STATE_ACTION", "        ", eventStateMap);
        lines.push(pyActionCode);
        lines.push("");
      } else {
        t.actionMethodName = transitionActionMap.get(actionKey);
      }
    }

    // Expand transitions with base-state aliases (e.g., WaitingPayment_Failed usable from WaitingPayment)
    const tableTransitions = [...actionTransitions];
    const seenTableKeys = new Set(tableTransitions.map((t) => `${t.from}::${t.event}`));
    for (const t of actionTransitions) {
      const baseName = t.from?.split("_")[0];
      if (baseName && baseName !== t.from) {
        const key = `${baseName}::${t.event}`;
        if (!seenTableKeys.has(key)) {
          const clone = { ...t, from: baseName };
          tableTransitions.push(clone);
          seenTableKeys.add(key);
        }
      }
    }

    // Build transition table
    lines.push("    def _build_sm_table(self) -> Dict:");
    lines.push('        """Build state machine transition table"""');
    lines.push("        table: Dict = {}");

    for (const t of tableTransitions) {
      const actionRef = t.actionOAL && t.actionMethodName ? `self.${t.actionMethodName}` : "None";
      lines.push(`        table.setdefault('${t.from}', {})['${t.event}'] = (None, ${actionRef}, '${t.to}')`);
    }
    lines.push("        return table");
    lines.push("");

    lines.push("    def _build_state_machine(self):");
    lines.push(`        \"\"\"Initialize state machine\"\"\"`);
    lines.push(`        initial_state = self.get_attr('currentState') or '${cls.stateMachine.initialState || ""}'`);
    lines.push(`        self.sm = StateMachine(self, initial_state, self._build_sm_table())`);
    lines.push("");

    // Helper method to dispatch events with parameters
    lines.push("    def dispatch_event(self, event_name: str, **payload) -> bool:");
    lines.push('        """Dispatch an event to this instance\'s state machine"""');
    lines.push("        if hasattr(self, 'sm'):");
    lines.push("            return self.sm.dispatch(event_name, payload)");
    lines.push("        return False");
    lines.push("");
  }

  // [KOMPONEN: Bridges / External Entities]
  if (cls.isExternal) {
    // External entities have class methods as bridges
    for (const op of cls.operations || []) {
      const signature = op.signature || op.name || String(op);
      const match = signature.match(/(\w+)\((.*)\)/);
      const opName = match ? match[1] : signature.replace(/\W/g, "");
      const params = op.parameters || [];

      // Build parameter signature for classmethod
      let paramSig = "cls";
      for (const p of params) {
        paramSig += `, ${p.name}: ${p.pythonType || "Any"} = ${p.default || "None"}`;
      }
      paramSig += ", **kwargs";

      lines.push(`    @classmethod`);
      lines.push(`    def ${opName}(${paramSig}):`);
      lines.push(`        \"\"\"Bridge operation: ${signature}\"\"\"`);
      lines.push(`        print(f"[BRIDGE] ${cls.kl}::${opName} called")`);
      lines.push(`        # TODO: Implement external service integration`);
      lines.push(`        pass`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function generateModelFiles(model) {
  const files = {};
  Object.assign(files, generateRuntimeFiles(model.relationships, model.associationClasses || []));

  // Generate model classes
  for (const c of model.classes || []) {
    const fname = `models/${(c.name || "Class").replace(/\W/g, "")}.py`;
    files[fname] = genClassFile(c, model.classes, model);
  }

  // Generate association classes for many-to-many relationships
  for (const assoc of model.associationClasses || []) {
    const fname = `models/${assoc.name.replace(/\W/g, "")}.py`;
    files[fname] = generateAssociationClass(assoc, model);
  }

  // [KOMPONEN: Functions]
  if (model.functions && model.functions.length > 0) {
    const funcLines = [];
    funcLines.push(`# functions.py`);
    funcLines.push(`from __future__ import annotations`);
    funcLines.push(`from typing import Any, Dict, Optional`);
    funcLines.push(`from runtime.base import RuntimeServices`);
    funcLines.push(`from runtime.storage import ObjectStore`);
    funcLines.push(`from runtime.relationship import relate, unrelate, select_related`);
    funcLines.push(``);

    for (const func of model.functions) {
      const signature = func.signature || func.name;
      const match = signature.match(/(\w+)\((.*)\)/);
      const funcName = match ? match[1] : signature.replace(/\W/g, "");

      funcLines.push(`def ${funcName}(**kwargs):`);
      funcLines.push(`    """OAL Function: ${funcName}"""`);
      funcLines.push(`    print(f"[FUNCTION] Executing ${funcName}")`);
      if (func.action) {
        const pyFuncCode = OAL_TO_PYTHON_SIMULATION(func.action, "Global", "None", "FUNCTION", "    ");
        funcLines.push(pyFuncCode);
      } else {
        funcLines.push(`    pass`);
      }
      funcLines.push(``);
    }
    files["functions.py"] = funcLines.join("\n");
  }

  // Generate models/__init__.py for cleaner imports
  const initLines = [];
  initLines.push("# models/__init__.py");
  initLines.push("# Auto-generated model exports");
  initLines.push("");
  for (const c of model.classes || []) {
    const clsName = (c.name || "Class").replace(/\W/g, "");
    initLines.push(`from models.${clsName} import ${clsName}`);
    if (c.kl && c.kl !== clsName) {
      initLines.push(`${c.kl} = ${clsName}  # KeyLetter alias`);
    }
  }
  for (const assoc of model.associationClasses || []) {
    const assocName = assoc.name.replace(/\W/g, "");
    initLines.push(`from models.${assocName} import ${assocName}`);
  }
  initLines.push("");
  initLines.push("__all__ = [");
  for (const c of model.classes || []) {
    const clsName = (c.name || "Class").replace(/\W/g, "");
    initLines.push(`    '${clsName}',`);
  }
  for (const assoc of model.associationClasses || []) {
    initLines.push(`    '${assoc.name.replace(/\W/g, "")}',`);
  }
  initLines.push("]");
  files["models/__init__.py"] = initLines.join("\n");

  // App Bootstrap with better demo setup
  const appLines = [];
  appLines.push("#!/usr/bin/env python3");
  appLines.push("# app.py - Application Bootstrap");
  appLines.push("# Generated by xtUML to Python Compiler");
  appLines.push("");
  appLines.push("from __future__ import annotations");
  appLines.push("import sys");
  appLines.push("");
  appLines.push("# Import runtime");
  appLines.push("from runtime.storage import ObjectStore");
  appLines.push("from runtime.relationship import relate, unrelate, select_related");
  appLines.push("from runtime.base import RuntimeServices");
  appLines.push("");

  if (model.functions && model.functions.length > 0) {
    appLines.push("# Import global functions");
    appLines.push("from functions import *");
    appLines.push("");
  }

  appLines.push("# Import model classes");
  for (const c of model.classes || []) {
    const clsName = (c.name || "Class").replace(/\W/g, "");
    appLines.push(`from models.${clsName} import ${clsName}`);
  }
  for (const assoc of model.associationClasses || []) {
    appLines.push(`from models.${assoc.name.replace(/\W/g, "")} import ${assoc.name.replace(/\W/g, "")}`);
  }
  appLines.push("");

  appLines.push("def setup_demo_data():");
  appLines.push('    """Create demo instances for testing"""');
  appLines.push("    print('Setting up demo data...')");
  appLines.push("    instances = {}");
  appLines.push("");

  // Create demo instances for each class
  for (const c of model.classes || []) {
    if (c.isExternal) continue; // Skip external entities
    const clsName = (c.name || "Class").replace(/\W/g, "");
    appLines.push(`    # Create ${clsName} instance`);
    appLines.push(`    instances['${clsName.toLowerCase()}'] = ${clsName}._create_instance(id='${clsName.toLowerCase()}_1')`);
    appLines.push(`    print(f"  Created: {instances['${clsName.toLowerCase()}']}")`);
    appLines.push("");
  }

  appLines.push("    return instances");
  appLines.push("");

  appLines.push("def run():");
  appLines.push('    """Main entry point"""');
  appLines.push("    print('='*60)");
  appLines.push(`    print('${model.modelName || "xtUML Model"} - System Start')`);
  appLines.push("    print('='*60)");
  appLines.push("");
  appLines.push("    # Setup demo data");
  appLines.push("    instances = setup_demo_data()");
  appLines.push("");

  // Find main class (VendingMachine or first class with state machine)
  const mainClass = model.classes.find((c) => c.name === "VendingMachine") || model.classes.find((c) => c.stateMachine) || model.classes[0];

  if (mainClass && mainClass.stateMachine) {
    const clsName = mainClass.name.replace(/\W/g, "");
    appLines.push("    # Demo: Dispatch events to state machine");
    appLines.push(`    main_instance = instances.get('${clsName.toLowerCase()}')`);
    appLines.push("    if main_instance and hasattr(main_instance, 'sm'):");
    appLines.push("        print(f'\\nCurrent state: {main_instance.sm.get_current_state()}')");
    appLines.push("        print('Ready to dispatch events.')");
    appLines.push("        ");
    appLines.push("        # Example: Uncomment to dispatch an event");

    // Get first event from state machine
    if (mainClass.stateMachine.transitions && mainClass.stateMachine.transitions.length > 0) {
      const firstTransition = mainClass.stateMachine.transitions[0];
      const eventParams = firstTransition.eventParameters || [];
      let paramExample = "";
      if (eventParams.length > 0) {
        const paramParts = eventParams.map((p) => `${p.name}='example_value'`);
        paramExample = paramParts.join(", ");
      }
      appLines.push(`        # main_instance.dispatch_event('${firstTransition.event}'${paramExample ? ", " + paramExample : ""})`);
    }
  }

  appLines.push("");
  appLines.push("    print('\\nSimulation Ready. Use instances dict to interact with objects.')");
  appLines.push("    return instances");
  appLines.push("");
  appLines.push("if __name__ == '__main__':");
  appLines.push("    instances = run()");
  appLines.push("    ");
  appLines.push("    # Interactive mode hint");
  appLines.push("    print('\\n--- Interactive Mode ---')");
  appLines.push("    print('Available instances:', list(instances.keys()))");

  files["app.py"] = appLines.join("\n");

  return files;
}

// Generate association class for many-to-many relationships
function generateAssociationClass(assoc, model) {
  const lines = [];
  const className = assoc.name.replace(/\W/g, "");

  lines.push(`# models/${className}.py`);
  lines.push("# Association class for many-to-many relationship");
  lines.push("from __future__ import annotations");
  lines.push("import uuid");
  lines.push("from typing import Any, Dict, Optional");
  lines.push("from runtime.base import InstanceBase");
  lines.push("from runtime.storage import ObjectStore");
  lines.push("from runtime.relationship import relate, unrelate, select_related");
  lines.push("");
  lines.push(`from models.${assoc.fromClass.replace(/\W/g, "")} import ${assoc.fromClass.replace(/\W/g, "")}`);
  lines.push(`from models.${assoc.toClass.replace(/\W/g, "")} import ${assoc.toClass.replace(/\W/g, "")}`);
  lines.push("");

  lines.push(`class ${className}(InstanceBase):`);
  lines.push(`    """Association class for ${assoc.relId}: ${assoc.fromClass} <-> ${assoc.toClass}"""`);
  lines.push(`    kl = "${className}"`);
  lines.push("");
  lines.push("    def __init__(self, id: Optional[str] = None):");
  lines.push("        if id is None:");
  lines.push("            id = str(uuid.uuid4())");
  lines.push(`        super().__init__(id, "${className}")`);

  // Add referential attributes
  lines.push(`        self.set_attr('${assoc.fromClassKL}_ref', None)  # Reference to ${assoc.fromClass}`);
  lines.push(`        self.set_attr('${assoc.toClassKL}_ref', None)  # Reference to ${assoc.toClass}`);

  // Add any additional association attributes
  for (const attr of assoc.attributes || []) {
    const defaultVal = getDefaultValue(attr.data_type, attr.default_value);
    lines.push(`        self.set_attr('${attr.attribute_name}', ${defaultVal})  # ${attr.data_type || "any"}`);
  }

  lines.push(`        ObjectStore.register("${className}")`);
  lines.push(`        ObjectStore.create("${className}", self._id, self)`);
  lines.push("");

  // Factory method to create and link
  lines.push("    @classmethod");
  lines.push(`    def create_link(cls, from_inst: '${assoc.fromClass.replace(/\W/g, "")}', to_inst: '${assoc.toClass.replace(/\W/g, "")}', **attrs) -> '${className}':`);
  lines.push(`        """Create association instance and link both ends"""`);
  lines.push(`        assoc = cls._create_instance()`);
  lines.push(`        assoc.set_attr('${assoc.fromClassKL}_ref', from_inst)`);
  lines.push(`        assoc.set_attr('${assoc.toClassKL}_ref', to_inst)`);
  lines.push("        ");
  lines.push(`        relate("${assoc.relId}", from_inst, assoc)`);
  lines.push(`        relate("${assoc.relId}", assoc, to_inst)`);
  lines.push("        ");
  lines.push("        for key, value in attrs.items():");
  lines.push("            assoc.set_attr(key, value)");
  lines.push("        ");
  lines.push("        return assoc");
  lines.push("");

  // Method to get both ends
  lines.push(`    def get_${assoc.fromClass.toLowerCase()}(self) -> Optional['${assoc.fromClass.replace(/\W/g, "")}']:`);
  lines.push(`        return self.get_attr('${assoc.fromClassKL}_ref')`);
  lines.push("");
  lines.push(`    def get_${assoc.toClass.toLowerCase()}(self) -> Optional['${assoc.toClass.replace(/\W/g, "")}']:`);
  lines.push(`        return self.get_attr('${assoc.toClassKL}_ref')`);
  lines.push("");

  return lines.join("\n");
}
