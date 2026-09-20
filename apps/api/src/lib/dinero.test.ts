import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bolivaresAUsd, porcentaje, redondear, usd, usdABolivares } from './dinero.js';

describe('redondeo monetario', () => {
  it('redondea a 2 decimales alejandose del cero', () => {
    assert.equal(redondear(1.005), 1.01);
    assert.equal(redondear(2.675), 2.68);
    assert.equal(redondear(-1.005), -1.01);
    assert.equal(redondear(0.1 + 0.2), 0.3);
  });

  it('no arrastra error binario al sumar montos', () => {
    const total = [0.1, 0.2, 0.3, 0.4].reduce((a, v) => usd(a + v), 0);
    assert.equal(total, 1);
  });

  it('devuelve 0 ante valores no finitos', () => {
    assert.equal(redondear(Number.NaN), 0);
    assert.equal(redondear(Number.POSITIVE_INFINITY), 0);
  });
});

describe('conversion de moneda', () => {
  it('convierte USD a bolivares y de vuelta', () => {
    assert.equal(usdABolivares(10, 36.5), 365);
    assert.equal(bolivaresAUsd(365, 36.5), 10);
  });

  it('no divide entre cero', () => {
    assert.equal(bolivaresAUsd(100, 0), 0);
  });
});

describe('impuestos', () => {
  it('calcula el IVA del 16%', () => {
    assert.equal(porcentaje(100, 16), 16);
    assert.equal(porcentaje(4.8, 16), 0.77);
  });

  it('calcula el IGTF del 3%', () => {
    assert.equal(porcentaje(9.75, 3), 0.29);
    assert.equal(porcentaje(5, 3), 0.15);
  });
});
