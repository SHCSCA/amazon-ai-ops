import React from 'react';

export type ProgressiveDetailsProps = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

export function ProgressiveDetails({ title, children, defaultOpen }: ProgressiveDetailsProps) {
  return (
    <details className="progressive-details" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="progressive-details-body">{children}</div>
    </details>
  );
}
