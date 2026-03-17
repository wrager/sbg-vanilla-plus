# Принципы разработки проекта SBG Vanilla+

## Common principles

1. **FOLLOW** SOLID, KISS, YAGNI.
2. **OBSERVE** Low coupling & High cohesion.
3. **PREFER** explicit over implicit.

## Type Safety

### Input/Output Types

1. **WIDEN** parameter types (accept abstractions).
2. **NARROW** return types (return concrete).

### Strict Typing

- **DON'T USE** `as` (Type Assertion) without type narrowing, except exceptional cases with explanatory comment.
- **FORBIDDEN** to use `@ts-ignore`.

## eslint

Disabling Errors:

1. **FORBIDDEN** to disable errors for entire file.
2. **FORBIDDEN** to disable all errors at once (`eslint-disable` without
   arguments).
3. **ALLOWED** to disable only specific rules for specific lines/blocks.
4. **MUST** explain reason in comment (`-- description`).

## Tests

1. Покрывать тестами любой новый функционал и любые изменения существующего
2. Стремиться к покрытию тестами всех веток кода

## Readability

1. **CHOOSE** readability over micro-optimizations.
2. **USE** clear names without non-obvious abbreviations.
