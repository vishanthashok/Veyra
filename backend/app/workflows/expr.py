"""Restricted arithmetic for the Formula node.

Grammar: numbers, column references written as [Column name], + - * /, parentheses, and the
functions round(x, n), abs(x), min(a, b, ...), max(a, b, ...). Everything is Decimal. The
expression is parsed with the ast module and checked against a whitelist before any row is
evaluated. Nothing is ever passed to eval or exec, and names other than the four functions are
rejected, so user input cannot reach Python objects.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal, DivisionByZero, InvalidOperation

from .table import NodeError, to_decimal

MAX_LENGTH = 500
_COL = re.compile(r"\[([^\[\]]{1,120})\]")
_FUNCS = {"round", "abs", "min", "max"}


class RowError(ValueError):
    """The expression is valid but cannot be computed for this row."""


def compile_expression(expr: str) -> tuple[Callable[[dict[str, str]], Decimal], list[str]]:
    """Return (evaluate(row) -> Decimal, referenced column names). Raises NodeError if invalid."""
    if not expr or not expr.strip():
        raise NodeError("Enter an expression, for example [Amount] * 0.15.")
    if len(expr) > MAX_LENGTH:
        raise NodeError(f"Expressions are limited to {MAX_LENGTH} characters.")
    columns: list[str] = []

    def sub(m: re.Match[str]) -> str:
        name = m.group(1).strip()
        if name not in columns:
            columns.append(name)
        return f"__c{columns.index(name)}"

    py = _COL.sub(sub, expr)
    try:
        tree = ast.parse(py, mode="eval")
    except SyntaxError as exc:
        raise NodeError("The expression is not valid. Use [Column], numbers, + - * / and ( ).") from exc
    _check(tree.body)

    def evaluate(row: dict[str, str]) -> Decimal:
        values: list[Decimal] = []
        for c in columns:
            d = to_decimal(row.get(c, ""))
            if d is None:
                raise RowError(f"[{c}] is blank or not a number")
            values.append(d)
        try:
            return _eval(tree.body, values)
        except (DivisionByZero, ZeroDivisionError) as exc:
            raise RowError("division by zero") from exc
        except InvalidOperation as exc:
            raise RowError("the result is not a number") from exc

    return evaluate, columns


def _check(node: ast.AST) -> None:
    if isinstance(node, ast.BinOp):
        if not isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            raise NodeError("Only + - * / are allowed.")
        _check(node.left)
        _check(node.right)
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, (ast.USub, ast.UAdd)):
            raise NodeError("Only + and - signs are allowed.")
        _check(node.operand)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise NodeError("Only numbers and [Column] references are allowed.")
    elif isinstance(node, ast.Name):
        if not node.id.startswith("__c"):
            raise NodeError(f"Unknown name {node.id!r}. Wrap column names in brackets: [{node.id}].")
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCS:
            raise NodeError("Only round, abs, min and max are allowed.")
        if node.keywords or not node.args:
            raise NodeError(f"{node.func.id}() takes positional arguments only.")
        if node.func.id == "round":
            if (
                len(node.args) != 2
                or not isinstance(node.args[1], ast.Constant)
                or not isinstance(node.args[1].value, int)
            ):
                raise NodeError("Use round(value, places), for example round([Amount] * 0.15, 2).")
            if not 0 <= node.args[1].value <= 6:
                raise NodeError("round() places must be between 0 and 6.")
        if node.func.id == "abs" and len(node.args) != 1:
            raise NodeError("abs() takes one value.")
        for a in node.args:
            _check(a)
    else:
        raise NodeError("The expression uses something that is not allowed.")


def _eval(node: ast.AST, values: list[Decimal]) -> Decimal:
    if isinstance(node, ast.BinOp):
        a, b = _eval(node.left, values), _eval(node.right, values)
        if isinstance(node.op, ast.Add):
            return a + b
        if isinstance(node.op, ast.Sub):
            return a - b
        if isinstance(node.op, ast.Mult):
            return a * b
        if b == 0:
            raise DivisionByZero
        return a / b
    if isinstance(node, ast.UnaryOp):
        v = _eval(node.operand, values)
        return -v if isinstance(node.op, ast.USub) else v
    if isinstance(node, ast.Constant):
        return Decimal(str(node.value))  # str() keeps 0.1 exact instead of the float's binary value
    if isinstance(node, ast.Name):
        return values[int(node.id[3:])]
    assert isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    name = node.func.id
    if name == "round":
        places = int(node.args[1].value)  # type: ignore[attr-defined]
        return _eval(node.args[0], values).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    args = [_eval(a, values) for a in node.args]
    if name == "abs":
        return abs(args[0])
    return min(args) if name == "min" else max(args)
