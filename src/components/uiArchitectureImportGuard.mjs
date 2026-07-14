import ts from 'typescript';

export const hasRuntimeStaticImport = (source, moduleSpecifier) => {
  const expectedModule = String(moduleSpecifier || '');
  if (!expectedModule) return false;

  const sourceFile = ts.createSourceFile(
    'ui-architecture-import-guard.tsx',
    String(source || ''),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  return sourceFile.statements.some((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === expectedModule
    && !statement.importClause?.isTypeOnly
  ));
};
