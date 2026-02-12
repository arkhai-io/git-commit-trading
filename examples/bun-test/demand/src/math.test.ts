import { describe, expect, test } from "bun:test";
import { add, subtract, multiply } from "./math";

describe("Math functions", () => {
	test("add returns sum of two numbers", () => {
		expect(add(2, 3)).toBe(5);
		expect(add(-1, 1)).toBe(0);
		expect(add(0, 0)).toBe(0);
	});

	test("subtract returns difference of two numbers", () => {
		expect(subtract(5, 3)).toBe(2);
		expect(subtract(1, 1)).toBe(0);
		expect(subtract(0, 5)).toBe(-5);
	});

	test("multiply returns product of two numbers", () => {
		expect(multiply(2, 3)).toBe(6);
		expect(multiply(-2, 3)).toBe(-6);
		expect(multiply(0, 100)).toBe(0);
	});
});
