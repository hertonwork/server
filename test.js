// Add your own test cases here
let testNumber = 1;
const rightTick = "\u2713";
const wrongTick = "\u2717";
function test(params, expected, method) {
    try {
        var output = method(params);
    } catch(error) {
        console.error(error.toString());
    }
    let out = '';
    if (output == expected) {
        out = `${rightTick} Test #${testNumber}`;
    } else {
        out = `${wrongTick} Test #${testNumber}`
        + ` Expected [${expected.toString()}]`
        + ` Your output: [${output}]`;
    }
    console.log(out);
    testNumber++;
}

test('param', true, param => Boolean(param));