// Fast (unit) tests: enforce NODE_ENV=test
if (process.env.NODE_ENV !== 'test') {
  throw new Error('test:fast requires NODE_ENV=test. Set it explicitly or use npm run test:fast');
}
