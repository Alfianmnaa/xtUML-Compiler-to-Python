// compiler/utils.js

/**
 * OAL 2008 Data Type Mapping to Python
 * Based on xtUML/OAL Standard Types
 */
export const OAL_TYPE_MAP = {
  // Primitive Types
  boolean: { python: "bool", default: "False" },
  integer: { python: "int", default: "0" },
  real: { python: "float", default: "0.0" },
  string: { python: "str", default: "''" },
  unique_id: { python: "str", default: "str(uuid.uuid4())" },

  // Date/Time Types
  date: { python: "str", default: "''" }, // ISO format string
  timestamp: { python: "float", default: "0.0" },
  datetime: { python: "str", default: "''" },
  inst_ref_set: { python: "list", default: "[]" },

  // Arbitrary (void/any)
  void: { python: "None", default: "None" },
  any: { python: "Any", default: "None" },

  // Collection types
  set: { python: "set", default: "set()" },
  bag: { python: "list", default: "[]" },
  sequence: { python: "list", default: "[]" },
};

/**
 * Get Python type and default value for OAL data type
 */
export function mapOalTypeToPython(oalType) {
  if (!oalType) return { python: "Any", default: "None" };

  const lowerType = oalType.toLowerCase().trim();

  // Handle inst_ref<ClassName>
  if (lowerType.startsWith("inst_ref<")) {
    const refClass = oalType.match(/inst_ref<(\w+)>/i)?.[1] || "object";
    return { python: `Optional['${refClass}']`, default: "None", isRef: true, refClass };
  }

  // Handle inst_ref_set<ClassName>
  if (lowerType.startsWith("inst_ref_set<")) {
    const refClass = oalType.match(/inst_ref_set<(\w+)>/i)?.[1] || "object";
    return { python: `List['${refClass}']`, default: "[]", isRefSet: true, refClass };
  }

  // Check basic types
  if (OAL_TYPE_MAP[lowerType]) {
    return OAL_TYPE_MAP[lowerType];
  }

  // Default fallback
  return { python: "Any", default: "None" };
}

/**
 * Generate Python default value based on OAL data type and optional explicit default
 */
export function getDefaultValue(dataType, explicitDefault) {
  // If explicit default is provided, use it
  if (explicitDefault !== null && explicitDefault !== undefined) {
    return escapePythonValue(explicitDefault, dataType);
  }

  const typeInfo = mapOalTypeToPython(dataType);
  return typeInfo.default;
}

/**
 * Escape/convert value to Python literal based on data type
 */
export function escapePythonValue(value, dataType) {
  if (value === null || value === undefined) return "None";

  const lowerType = (dataType || "").toLowerCase().trim();

  // Boolean
  if (lowerType === "boolean") {
    if (typeof value === "boolean") return value ? "True" : "False";
    if (typeof value === "string") {
      return value.toLowerCase() === "true" ? "True" : "False";
    }
    return value ? "True" : "False";
  }

  // Integer
  if (lowerType === "integer") {
    return String(parseInt(value, 10) || 0);
  }

  // Real/Float
  if (lowerType === "real") {
    return String(parseFloat(value) || 0.0);
  }

  // String types
  if (lowerType === "string" || lowerType === "date" || lowerType === "datetime") {
    return JSON.stringify(String(value));
  }

  // Instance references
  if (lowerType.startsWith("inst_ref")) {
    return "None";
  }

  // Default string conversion
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "True" : "False";

  return JSON.stringify(String(value));
}

/**
 * Legacy function - keep for backward compatibility
 */
export function escapePythonString(s) {
  if (s === null || s === undefined) return "None";
  return JSON.stringify(String(s));
}

/**
 * Parse OAL parameter signature (e.g., "name: string, amount: real")
 * Returns array of { name, type, pythonType, default }
 */
export function parseOalParameters(paramString) {
  if (!paramString || !paramString.trim()) return [];

  const params = [];
  const parts = paramString.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Format: name: type or just name
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      const name = trimmed.substring(0, colonIdx).trim();
      const type = trimmed.substring(colonIdx + 1).trim();
      const typeInfo = mapOalTypeToPython(type);
      params.push({
        name,
        oalType: type,
        pythonType: typeInfo.python,
        default: typeInfo.default,
      });
    } else {
      params.push({
        name: trimmed,
        oalType: "any",
        pythonType: "Any",
        default: "None",
      });
    }
  }

  return params;
}
