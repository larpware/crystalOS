/*
 * CrystalOS — exit-country list tests
 *
 * The picker must never promise more than the pool can deliver, and a bad code
 * must be reported rather than quietly becoming a worldwide scan. Both are
 * decided here, offline, so they are what is pinned.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { COUNTRIES, countryName, listCountries, normaliseCountry } from "./countries.mjs";

describe("normaliseCountry", () => {
  test("upper-cases a code and trims it", () => {
    assert.equal(normaliseCountry(" us "), "US");
    assert.equal(normaliseCountry("de"), "DE");
  });

  test("blank and the explicit 'anywhere' words mean no country", () => {
    for (const value of [null, undefined, "", "  ", "any", "ALL", "anywhere"]) {
      assert.equal(normaliseCountry(value), null, `"${value}" should mean anywhere`);
    }
  });

  test("something that is not a two-letter code is an error, not a worldwide scan", () => {
    for (const value of ["USA", "U", "12", "U1", "united states"]) {
      assert.throws(() => normaliseCountry(value), /two-letter code/i, `"${value}" should be rejected`);
    }
  });
});

describe("listCountries", () => {
  test("leads with an 'anywhere' entry and then real countries", () => {
    const list = listCountries();
    assert.equal(list[0].code, "");
    assert.ok(list.length > 10);
    assert.ok(list.every((entry) => /^([A-Z]{2})?$/.test(entry.code)));
  });

  test("every listed code is a valid request", () => {
    for (const entry of COUNTRIES) {
      assert.equal(normaliseCountry(entry.code), entry.code);
      assert.ok(entry.name.length > 0);
    }
  });

  test("a name is looked up for a known code, and the code stands in otherwise", () => {
    assert.equal(countryName("US"), "United States");
    assert.equal(countryName("us"), "United States");
    assert.equal(countryName("ZZ"), "ZZ");
    assert.equal(countryName(null), null);
  });
});
