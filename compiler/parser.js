// compiler/parser.js
import { isKnownOalType, parseOalParameters } from "./utils.js";

export class ValidationError extends Error {
  constructor(errors) {
    const message = errors.map((e, idx) => `${idx + 1}. [${e.path}] ${e.message}${e.hint ? ` (hint: ${e.hint})` : ""}`).join("\n");
    super(message || "Validation failed");
    this.name = "ValidationError";
    this.errors = errors;
  }
}

function pushError(errors, path, message, hint = "") {
  errors.push({ path, message, hint });
}

// Basic OAL linting to catch early typos and unknown constructs
function lintOalAction(actionText, path, context, errors) {
  if (!actionText || typeof actionText !== "string") return;

  const lines = actionText.split("\n");
  const add = (msg, hint, lineNo) => pushError(errors, `${path}${lineNo ? ".line" + lineNo : ""}`, msg, hint);

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (!line) return;

    // Comments are allowed
    if (line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*/")) return;

    // Control structures
    if (/^if\s*\(.*\)\s*;?$/i.test(line)) return;
    if (/^elif\s*\(.*\)\s*;?$/i.test(line)) return;
    if (/^else\s*;?$/i.test(line)) return;
    if (/^end if\s*;?$/i.test(line)) return;
    if (/^while\s*\(.*\)\s*;?$/i.test(line)) return;
    if (/^end while\s*;?$/i.test(line)) return;
    if (/^for each\s+\w+\s+in\s+[\w.]+/i.test(line)) return;
    if (/^end for\s*;?$/i.test(line)) return;
    if (/^(break|continue)\s*;?$/i.test(line)) return;
    if (/^return\b/i.test(line)) return;

    // Selection
    const selectMatch = line.match(/select\s+(any|one|many)\s+(\w+)\s+from\s+instances\s+of\s+(\w+)(?:\s+where\s+.+)?;?/i);
    if (selectMatch) {
      const classRef = selectMatch[3].toLowerCase();
      if (!context.classRefs.has(classRef)) add(`Unknown class reference '${selectMatch[3]}' in selection`, "Periksa penulisan KL/nama kelas", lineNo);
      return;
    }

    const navMatch = line.match(/select\s+(any|one|many)\s+\w+\s+related\s+by\s+\w+->\w+\[(R\w+)\];?/i);
    if (navMatch) {
      const relId = navMatch[2]?.toLowerCase();
      if (relId && !context.relationshipIds.has(relId)) add(`Unknown relationship '${navMatch[2]}'`, "Pastikan rel_id terdaftar", lineNo);
      return;
    }

    // Instance lifecycle
    if (/^create\s+object\s+instance\s+\w+\s+of\s+\w+\s*;?$/i.test(line)) {
      const kl = line.match(/of\s+(\w+)/i)?.[1];
      if (kl && !context.classRefs.has(kl.toLowerCase())) add(`Unknown class '${kl}' in create instance`, "Gunakan KL/nama class yang valid", lineNo);
      return;
    }
    if (/^delete\s+object\s+instance\s+\w+\s*;?$/i.test(line)) return;

    // Relationship management
    const relateMatch = line.match(/^(un)?relate\s+\w+\s+(?:to|from)\s+\w+\s+across\s+(R\w+)\s*;?/i);
    if (relateMatch) {
      const relId = relateMatch[2].toLowerCase();
      if (!context.relationshipIds.has(relId)) add(`Unknown relationship '${relateMatch[2]}'`, "rel_id harus ada di daftar relationships", lineNo);
      return;
    }

    const unrelNavMatch = line.match(/unrelate\s+\w+\s+from\s+self->\w+\[(R\w+)\]\s+across\s+(R\w+)/i);
    if (unrelNavMatch) {
      const relId = (unrelNavMatch[2] || unrelNavMatch[1]).toLowerCase();
      if (!context.relationshipIds.has(relId)) add(`Unknown relationship '${unrelNavMatch[2] || unrelNavMatch[1]}'`, "Periksa rel_id pada unrelate", lineNo);
      return;
    }

    // Messaging / events
    if (/^send\s+\w+\(.*\)\s+to\s+\w+;?$/i.test(line)) return;

    const createEvtMatch = line.match(/create\s+event\s+instance\s+\w+\s+of\s+[A-Za-z0-9_:]+\(.*\)\s+to\s+.+;?/i);
    if (createEvtMatch) return;

    const genMatch = line.match(/generate\s+\w+:(\w+)\(.*\)\s+to\s+.+;?/i);
    if (genMatch) {
      const evtName = genMatch[1].toLowerCase();
      if (!context.eventNames.has(evtName)) {
        add(`Event '${genMatch[1]}' is not defined in events`, "Tambahkan ke blok events atau perbaiki penulisan", lineNo);
      }
      return;
    }

    // Bridges / operations / functions
    if (/^\w+::\w+\(.*\)\s*;?$/i.test(line)) return;
    if (/^\w+\.\w+\(.*\)\s*;?$/i.test(line)) return;
    if (/^\w+\(.*\)\s*;?$/i.test(line)) return;

    // Assignments
    if (/^(assign\s+)?[^=]+\s*=\s*.+;$/i.test(line)) return;

    // If nothing matched, mark as unknown OAL
    add(`Unrecognized OAL statement: '${line}'`, "Periksa typo/format OAL", lineNo);
  });
}

function validateJsonModel(jsonObj) {
  const errors = [];

  if (!jsonObj || typeof jsonObj !== "object") {
    throw new ValidationError([{ path: "root", message: "Input must be a JSON object" }]);
  }

  // Resolve top-level collections with defaults
  const classes = jsonObj.model || jsonObj.classes || [];
  const relationships = jsonObj.relationships || [];
  const events = jsonObj.events || [];
  const functions = jsonObj.functions || [];
  const generalizations = jsonObj.generalizations || [];

  if (!Array.isArray(classes)) pushError(errors, "classes", "`model` or `classes` must be an array");
  if (!Array.isArray(relationships)) pushError(errors, "relationships", "`relationships` must be an array if provided");
  if (!Array.isArray(events)) pushError(errors, "events", "`events` must be an array if provided");
  if (!Array.isArray(functions)) pushError(errors, "functions", "`functions` must be an array if provided");
  if (!Array.isArray(generalizations)) pushError(errors, "generalizations", "`generalizations` must be an array if provided");

  // Short circuit if the main shapes are wrong
  if (errors.length) throw new ValidationError(errors);

  const idSet = new Map();
  const nameSet = new Map();
  const klSet = new Map();
  const classMap = new Map();
  const classRefs = new Set();
  const relationshipIds = new Set();
  const eventNames = new Set();

  // First pass: validate class shape and uniqueness
  classes.forEach((c, idx) => {
    const path = `classes[${idx}]`;
    if (!c || typeof c !== "object") {
      pushError(errors, path, "Class entry must be an object");
      return;
    }

    if (c.class_id === undefined || c.class_id === null) {
      pushError(errors, `${path}.class_id`, "Missing required field `class_id`");
    }
    if (c.class_name === undefined || c.class_name === null || c.class_name === "") {
      pushError(errors, `${path}.class_name`, "Missing required field `class_name`");
    }
    if (c.KL === undefined || c.KL === null || c.KL === "") {
      pushError(errors, `${path}.KL`, "Missing required field `KL` (key letters)", "Provide a short unique code, e.g., C1");
    }

    const classIdKey = String(c.class_id ?? "").toLowerCase();
    const classNameKey = String(c.class_name ?? "").toLowerCase();
    const classKlKey = String(c.KL ?? "").toLowerCase();

    if (c.class_id !== undefined && idSet.has(classIdKey)) pushError(errors, `${path}.class_id`, "Duplicate class_id", `Conflicts with ${idSet.get(classIdKey)}`);
    if (c.class_name !== undefined && nameSet.has(classNameKey)) pushError(errors, `${path}.class_name`, "Duplicate class_name", `Conflicts with ${nameSet.get(classNameKey)}`);
    if (c.KL !== undefined && klSet.has(classKlKey)) pushError(errors, `${path}.KL`, "Duplicate KL", `Conflicts with ${klSet.get(classKlKey)}`);

    if (c.class_id !== undefined) idSet.set(classIdKey, path);
    if (c.class_name !== undefined) nameSet.set(classNameKey, path);
    if (c.KL !== undefined) klSet.set(classKlKey, path);

    if (classIdKey) classRefs.add(classIdKey);
    if (classNameKey) classRefs.add(classNameKey);
    if (classKlKey) classRefs.add(classKlKey);

    if (c.attributes && !Array.isArray(c.attributes)) pushError(errors, `${path}.attributes`, "`attributes` must be an array");
    if (c.operations && !Array.isArray(c.operations)) pushError(errors, `${path}.operations`, "`operations` must be an array");
    if (c.states && !Array.isArray(c.states)) pushError(errors, `${path}.states`, "`states` must be an array");

    // Minimal structural checks
    (c.attributes || []).forEach((a, aIdx) => {
      const aPath = `${path}.attributes[${aIdx}]`;
      if (!a || typeof a !== "object") {
        pushError(errors, aPath, "Attribute must be an object");
        return;
      }
      if (!a.attribute_name) pushError(errors, `${aPath}.attribute_name`, "Attribute missing `attribute_name`");

      if (a.data_type && !isKnownOalType(a.data_type)) {
        pushError(errors, `${aPath}.data_type`, `Unknown data_type '${a.data_type}'`, "Gunakan tipe: boolean, integer, real, string, datetime, inst_ref<Cls>, inst_ref_set<Cls>");
      }
    });

    (c.states || []).forEach((s, sIdx) => {
      const sPath = `${path}.states[${sIdx}]`;
      if (!s || typeof s !== "object") {
        pushError(errors, sPath, "State must be an object");
        return;
      }
      if (!s.state_name) pushError(errors, `${sPath}.state_name`, "State missing `state_name`");
    });

    classMap.set(classIdKey, c);
    classMap.set(classNameKey, c);
    classMap.set(classKlKey, c);
  });

  // Relationships cross-check
  (relationships || []).forEach((rel, idx) => {
    const path = `relationships[${idx}]`;
    if (!rel || typeof rel !== "object") {
      pushError(errors, path, "Relationship must be an object");
      return;
    }
    if (!rel.rel_id && !rel.relId) pushError(errors, `${path}.rel_id`, "Missing `rel_id`");

    const relKey = String(rel.rel_id || rel.relId || "").toLowerCase();
    if (relKey) relationshipIds.add(relKey);

    const fromRef = rel.from_class || rel.fromClass || rel.from || rel.super || rel.source_class;
    const toRef = rel.to_class || rel.toClass || rel.to || rel.sub || rel.target_class;
    if (!fromRef) pushError(errors, `${path}.from_class`, "Missing `from_class`");
    if (!toRef) pushError(errors, `${path}.to_class`, "Missing `to_class`");

    if (fromRef && !classMap.has(String(fromRef).toLowerCase())) pushError(errors, `${path}.from_class`, "Unknown class reference", "Ensure `from_class` matches an existing class_id/KL/name");
    if (toRef && !classMap.has(String(toRef).toLowerCase())) pushError(errors, `${path}.to_class`, "Unknown class reference", "Ensure `to_class` matches an existing class_id/KL/name");
  });

  // Attributes cross-check (related classes)
  classes.forEach((c, idx) => {
    (c.attributes || []).forEach((a, aIdx) => {
      const aPath = `classes[${idx}].attributes[${aIdx}]`;
      const ref = a.related_class_id || a.related_class_name;
      if (ref && !classMap.has(String(ref).toLowerCase())) {
        pushError(errors, `${aPath}.related_class_id`, "Unknown related class", "Use a valid class_id/KL/name");
      }
    });
  });

  // Events cross-check
  (events || []).forEach((e, idx) => {
    const path = `events[${idx}]`;
    if (!e || typeof e !== "object") {
      pushError(errors, path, "Event must be an object");
      return;
    }
    if (!e.event_name) pushError(errors, `${path}.event_name`, "Missing `event_name`");
    if (e.class_id === undefined || e.class_id === null) pushError(errors, `${path}.class_id`, "Missing `class_id`");
    if (e.class_id !== undefined && !classMap.has(String(e.class_id).toLowerCase())) pushError(errors, `${path}.class_id`, "Unknown class for event");

    if (e.event_name) eventNames.add(String(e.event_name).toLowerCase());

    (e.parameters || []).forEach((p, pIdx) => {
      const pPath = `${path}.parameters[${pIdx}]`;
      if (typeof p === "string") {
        parseOalParameters(p).forEach((param) => {
          if (param.oalType && !isKnownOalType(param.oalType)) pushError(errors, `${pPath}.type`, `Unknown parameter type '${param.oalType}'`);
        });
      } else {
        const type = p.data_type || p.type || p.oalType;
        if (type && !isKnownOalType(type)) pushError(errors, `${pPath}.type`, `Unknown parameter type '${type}'`);
      }
    });
  });

  // Generalizations cross-check
  (generalizations || []).forEach((g, idx) => {
    const path = `generalizations[${idx}]`;
    const superRef = g.super || g.super_class || g.superClass || g.superclass || g.parent_class || g.parent || g.base || g.super_type;
    const subRef = g.sub || g.sub_class || g.subClass || g.subclass || g.child_class || g.child || g.specific || g.sub_type;
    if (!superRef) pushError(errors, `${path}.super_class`, "Missing super class reference");
    if (!subRef) pushError(errors, `${path}.sub_class`, "Missing sub class reference");
    if (superRef && !classMap.has(String(superRef).toLowerCase())) pushError(errors, `${path}.super_class`, "Unknown super class reference");
    if (subRef && !classMap.has(String(subRef).toLowerCase())) pushError(errors, `${path}.sub_class`, "Unknown sub class reference");
  });

  // State machine sanity: ensure next_state refers to a known state name if provided
  classes.forEach((c, idx) => {
    const stateNames = new Set((c.states || []).map((s) => s?.state_name).filter(Boolean));
    (c.states || []).forEach((s, sIdx) => {
      if (s && s.next_state && !stateNames.has(s.next_state)) {
        pushError(errors, `classes[${idx}].states[${sIdx}].next_state`, "Unknown `next_state`", "Use a state_name defined in this class");
      }

      const evtList = Array.isArray(s?.state_event) ? s.state_event : [s.state_event].filter(Boolean);
      evtList.forEach((evt) => {
        const evtName = String(evt || "")
          .replace(/\[.*\]/, "")
          .toLowerCase();
        if (evtName && !eventNames.has(evtName)) {
          pushError(errors, `classes[${idx}].states[${sIdx}].state_event`, `Unknown event '${evt}'`, "Pastikan event terdaftar pada blok events");
        }
      });

      lintOalAction(s?.action || "", `classes[${idx}].states[${sIdx}].action`, { classRefs, relationshipIds, eventNames }, errors);
    });
  });

  // Operations parameter and action linting
  classes.forEach((c, cIdx) => {
    (c.operations || []).forEach((op, opIdx) => {
      const opPath = `classes[${cIdx}].operations[${opIdx}]`;
      if (typeof op === "string") {
        const match = op.match(/\w+\((.*)\)/);
        if (match && match[1]) {
          parseOalParameters(match[1]).forEach((p) => {
            if (p.oalType && !isKnownOalType(p.oalType)) pushError(errors, `${opPath}.parameters`, `Unknown parameter type '${p.oalType}'`);
          });
        }
      } else if (op && typeof op === "object") {
        const paramStr = op.parameters || op.params || op.signature?.match(/\((.*)\)/)?.[1];
        if (Array.isArray(op.parameters)) {
          op.parameters.forEach((p, pIdx) => {
            const pPath = `${opPath}.parameters[${pIdx}]`;
            if (typeof p === "string") {
              parseOalParameters(p).forEach((param) => {
                if (param.oalType && !isKnownOalType(param.oalType)) pushError(errors, `${pPath}`, `Unknown parameter type '${param.oalType}'`);
              });
            } else {
              const type = p.data_type || p.type || p.oalType;
              if (type && !isKnownOalType(type)) pushError(errors, `${pPath}`, `Unknown parameter type '${type}'`);
            }
          });
        } else if (typeof paramStr === "string") {
          parseOalParameters(paramStr).forEach((p) => {
            if (p.oalType && !isKnownOalType(p.oalType)) pushError(errors, `${opPath}.parameters`, `Unknown parameter type '${p.oalType}'`);
          });
        }
        if (op.action) lintOalAction(op.action, `${opPath}.action`, { classRefs, relationshipIds, eventNames }, errors);
      }
    });
  });

  if (errors.length) throw new ValidationError(errors);

  return { classes, relationships, events, functions, generalizations };
}

export function validateAndNormalize(jsonObj) {
  const { classes, relationships, events, functions, generalizations } = validateJsonModel(jsonObj);
  const model = {};

  model.modelName = jsonObj.sub_name || "xtuml_model";
  model.classes = [];
  model.relationships = relationships;
  model.generalizations = [];

  // Build class lookup map for quick access
  const classMap = {};
  const normalizedClassMap = {};
  for (const c of classes) {
    classMap[c.class_id] = c;
    classMap[c.class_name] = c;
    if (c.KL) classMap[c.KL] = c;
  }

  const getClassByRef = (ref) => {
    if (!ref) return null;
    return classMap[ref] || classMap[String(ref)] || null;
  };

  const generalizationSet = new Set();
  const addGeneralization = (superRef, subRef, meta = {}) => {
    const superRaw = getClassByRef(superRef);
    const subRaw = getClassByRef(subRef);
    if (!superRaw || !subRaw) return;

    const key = `${superRaw.class_id}::${subRaw.class_id}`;
    if (generalizationSet.has(key)) return;
    generalizationSet.add(key);

    const superNorm = normalizedClassMap[superRaw.class_id] || normalizedClassMap[superRaw.class_name] || normalizedClassMap[superRaw.KL];
    const subNorm = normalizedClassMap[subRaw.class_id] || normalizedClassMap[subRaw.class_name] || normalizedClassMap[subRaw.KL];

    if (subNorm) subNorm.superClass = superNorm?.name || superRaw.class_name;
    if (superNorm) {
      superNorm.subClasses = superNorm.subClasses || [];
      if (!superNorm.subClasses.includes(subNorm?.name || subRaw.class_name)) superNorm.subClasses.push(subNorm?.name || subRaw.class_name);
    }

    model.generalizations.push({
      relId: meta.relId || meta.rel_id || meta.id || `GEN_${superRaw.class_id}_${subRaw.class_id}`,
      superClass: superNorm?.name || superRaw.class_name,
      superClassId: superRaw.class_id,
      superClassKL: superRaw.KL,
      subClass: subNorm?.name || subRaw.class_name,
      subClassId: subRaw.class_id,
      subClassKL: subRaw.KL,
      source: meta.source || "relationships",
    });
  };

  // Parse events with parameters
  const eventDefinitions = {};
  for (const evt of events || []) {
    const params = (evt.parameters || []).map((p) => {
      if (typeof p === "string") {
        // Parse "name: type" format
        const parsed = parseOalParameters(p);
        return parsed[0] || { name: p, oalType: "any", pythonType: "Any" };
      }
      return p;
    });

    eventDefinitions[evt.event_name] = {
      id: evt.event_id,
      classId: evt.class_id,
      name: evt.event_name,
      parameters: params,
    };
  }
  model.eventDefinitions = eventDefinitions;

  for (const c of classes) {
    const cls = {
      id: c.class_id,
      name: c.class_name,
      keyLetters: c.KL,
      isExternal: c.is_external || false,
      attributes: [],
      operations: [],
      stateMachine: null,
      kl: c.KL,
      superClass: null,
      subClasses: [],
    };

    // Attributes (Normalize data type string/real/int)
    const attrs = c.attributes || [];
    for (const a of attrs) {
      cls.attributes.push({
        name: a.attribute_name,
        dataType: a.data_type,
        defaultValue: a.default_value !== undefined ? a.default_value : null,
        type: a.attribute_type,
        relatedClassId: a.related_class_id || null,
        relatedClassName: a.related_class_name || null,
        relationshipId: a.relationship_id || null,
      });
    }

    // Operations - Parse with parameters
    for (const op of c.operations || []) {
      if (typeof op === "string") {
        const match = op.match(/(\w+)\((.*)\)/);
        if (match) {
          const opName = match[1];
          const params = parseOalParameters(match[2]);
          cls.operations.push({
            signature: op,
            name: opName,
            parameters: params,
            action: "",
          });
        } else {
          cls.operations.push({ signature: op, name: op, parameters: [], action: "" });
        }
      } else {
        // Already an object
        const sig = op.signature || op.name || "";
        const match = sig.match(/(\w+)\((.*)\)/);
        const params = match ? parseOalParameters(match[2]) : [];
        cls.operations.push({
          ...op,
          name: match ? match[1] : sig,
          parameters: params,
        });
      }
    }

    // State Machine (FIX: Use flat structure from user's custom JSON)
    if (c.states && c.states.length > 0) {
      const smNorm = {
        initialState: c.attributes.find((a) => a.attribute_name === "currentState")?.default_value || c.states[0].state_name,
        states: [], // Unique state names
        transitions: [], // All transitions (State ID is unique key)
      };
      const uniqueStates = new Set();

      for (const s of c.states) {
        if (!uniqueStates.has(s.state_name)) {
          smNorm.states.push({
            id: s.state_id,
            name: s.state_name,
          });
          uniqueStates.add(s.state_name);
        }

        // This structure uses state_id to map unique transitions, even if state_name repeats
        const events = Array.isArray(s.state_event) ? s.state_event : [s.state_event].filter((e) => e);

        for (const eventSignature of events) {
          const eventName = eventSignature.replace(/\[.*\]/, "").trim();

          // Get event parameters from event definitions
          const eventDef = eventDefinitions[eventName] || {};

          smNorm.transitions.push({
            from: s.state_name,
            event: eventName,
            eventSignature: eventSignature,
            eventParameters: eventDef.parameters || [],
            guard: null,
            actionOAL: s.action || "",
            to: s.next_state || s.state_name,
          });
        }
      }
      cls.stateMachine = smNorm;
    }

    model.classes.push(cls);
    normalizedClassMap[cls.id] = cls;
    normalizedClassMap[cls.name] = cls;
    if (cls.kl) normalizedClassMap[cls.kl] = cls;
  }

  // Explicit generalization definitions block (if provided)
  for (const g of generalizations || []) {
    const superRef = g.super || g.super_class || g.superClass || g.superclass || g.parent_class || g.parent || g.base || g.super_type;
    const subRef = g.sub || g.sub_class || g.subClass || g.subclass || g.child_class || g.child || g.specific || g.sub_type;
    addGeneralization(superRef, subRef, { ...g, source: "generalizations" });
  }

  // Analyze relationships for association classes (many-to-many)
  model.associationClasses = [];
  for (const rel of model.relationships) {
    const relType = (rel.type || rel.rel_type || "").toLowerCase();
    const isGeneralization =
      relType === "generalization" || relType === "inheritance" || rel.is_generalization || rel.kind === "generalization" || rel.category === "generalization" || rel.relationship_type === "generalization" || rel.generalization === true;

    const explicitSuper = rel.super_class || rel.superClass || rel.superclass || rel.parent_class || rel.parent || rel.base || rel.super_type;
    const explicitSub = rel.sub_class || rel.subClass || rel.subclass || rel.child_class || rel.child || rel.specific || rel.sub_type;

    if (isGeneralization || (explicitSuper && explicitSub)) {
      const superRef = explicitSuper || rel.from_class;
      const subRef = explicitSub || rel.to_class;
      rel.isGeneralization = true;
      addGeneralization(superRef, subRef, { ...rel, source: "relationships" });
      continue;
    }

    const fromMult = rel.from_class_multiplicity || "";
    const toMult = rel.to_class_multiplicity || "";

    // Detect many-to-many: both sides have multiplicity 0_star, 1_star, or similar
    const isManyFrom = fromMult.includes("star") || fromMult.includes("*");
    const isManyTo = toMult.includes("star") || toMult.includes("*");

    if (isManyFrom && isManyTo) {
      // Mark as needing association class
      rel.needsAssociationClass = true;

      // Generate association class name
      const fromClass = classMap[rel.from_class];
      const toClass = classMap[rel.to_class];
      const assocFromRef = rel.association_class || rel.association_class_id || rel.assoc_class || rel.assoc_class_id;
      const assocProvided = assocFromRef ? getClassByRef(assocFromRef) : null;
      if (fromClass && toClass) {
        const assocClassName = assocProvided ? assocProvided.class_name : `${fromClass.class_name}_${toClass.class_name}_${rel.rel_id}`;
        if (!assocProvided) {
          model.associationClasses.push({
            name: assocClassName,
            kl: assocClassName,
            relId: rel.rel_id,
            fromClass: fromClass.class_name,
            fromClassKL: fromClass.KL,
            toClass: toClass.class_name,
            toClassKL: toClass.KL,
            attributes: rel.association_attributes || [],
          });
        }
      }
    }
  }

  model.events = events || [];
  model.functions = functions || [];

  return model;
}
