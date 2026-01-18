import React from "react";

export function JsonView({ value }: { value: any }) {
  return (
    <pre style={{ background: "#0b1220", padding: 12, borderRadius: 12, overflow: "auto", maxHeight: 420 }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
