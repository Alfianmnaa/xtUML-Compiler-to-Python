// compiler/parser.js
import { parseOalParameters } from "./utils.js";

export function validateAndNormalize(jsonObj) {
  if (!jsonObj) throw new Error("No JSON provided");
  const model = {};

  model.modelName = jsonObj.sub_name || "xtuml_model";
  model.classes = [];
  model.relationships = jsonObj.relationships || [];

  const classes = jsonObj.model || jsonObj.classes || [];
  if (!Array.isArray(classes)) throw new Error("No classes[] found in JSON");

  // Build class lookup map for quick access
  const classMap = {};
  for (const c of classes) {
    classMap[c.class_id] = c;
    classMap[c.class_name] = c;
    if (c.KL) classMap[c.KL] = c;
  }

  // Parse events with parameters
  const eventDefinitions = {};
  for (const evt of jsonObj.events || []) {
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
  }

  // Analyze relationships for association classes (many-to-many)
  model.associationClasses = [];
  for (const rel of model.relationships) {
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
      if (fromClass && toClass) {
        const assocClassName = `${fromClass.class_name}_${toClass.class_name}_${rel.rel_id}`;
        model.associationClasses.push({
          name: assocClassName,
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

  model.events = jsonObj.events || [];
  model.functions = jsonObj.functions || [];

  return model;
}
