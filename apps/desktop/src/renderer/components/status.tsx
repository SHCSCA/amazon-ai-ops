import React from 'react';

export function RequirementList({ items }: { items: string[] }) {
  return (
    <ol className="requirement-list">
      {items.map((item, index) => (
        <li key={item}>
          <span>{index + 1}</span>
          {item}
        </li>
      ))}
    </ol>
  );
}
