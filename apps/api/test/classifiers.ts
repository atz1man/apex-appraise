/**
 * How the whole-codebase sweeps recognise a path by what it WRITES.
 *
 * Shared, because two sweeps ask "is this an approval path?" of the same
 * router — the benchmark feed and the approval pin — and a classifier written
 * twice is one edit away from meaning different things in each.
 *
 * Parse update-call data properties so a reviewStatus in `where` is not
 * mistaken for approval. Literal draft/review/refusal writes cannot approve;
 * dynamic values may. This also handles ternaries and transpiled quote styles.
 * Regression cases must prove both real approvals and comparison-only updates.
 */
import ts from 'typescript';

/** Read actual update data, not predicates that merely compare review state. */
export function approves(source: string): boolean {
  const file = ts.createSourceFile('resolver.ts', `const resolver = ${source};`, ts.ScriptTarget.Latest, true);
  let found = false;
  const inspectData = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file).replace(/['"]/g, '') === 'reviewStatus') {
      const value = node.initializer;
      const harmless = ts.isStringLiteral(value) && ['draft', 'in_review', 'changes_requested'].includes(value.text)
        || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword;
      if (!harmless) found = true;
    }
    ts.forEachChild(node, inspectData);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && /prisma\.appraisal\.(?:update|updateMany)$/.test(node.expression.getText(file))) {
      const argument = node.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText(file).replace(/['"]/g, '') === 'data') inspectData(property.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** writes a deal's stage */
export const completes = (s: string): boolean => /prisma\.deal\.update\(/.test(s) && /\bstage:/.test(s);
