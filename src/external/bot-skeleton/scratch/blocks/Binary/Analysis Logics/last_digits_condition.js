import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.last_digits_condition = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Last %1 digits are %2 digit %3'),
            args0: [
                {
                    type: 'input_value',
                    name: 'DIGITS_COUNT',
                    check: 'Number',
                },
                {
                    type: 'field_dropdown',
                    name: 'CONDITION',
                    options: [
                        [localize('less than'), 'LT'],
                        [localize('greater than'), 'GT'],
                        [localize('equal to'), 'EQ'],
                        [localize('not equal to'), 'NEQ'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'DIGIT',
                    check: 'Number',
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Checks if the last N digits meet the specified condition'),
            category: window.Blockly.Categories.Analysis_Logics,
        };
    },
    meta() {
        return {
            display_name: localize('Last Digits Condition'),
            description: localize('Checks if the last N digits meet the specified condition'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.last_digits_condition = block => {
    const digitsCount = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'DIGITS_COUNT',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '3';
    const condition = block.getFieldValue('CONDITION');
    const digit = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'DIGIT',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '5';

    let conditionCode;
    switch (condition) {
        case 'LT':
            conditionCode = `d < ${digit}`;
            break;
        case 'GT':
            conditionCode = `d > ${digit}`;
            break;
        case 'EQ':
            conditionCode = `d === ${digit}`;
            break;
        case 'NEQ':
            conditionCode = `d !== ${digit}`;
            break;
        default:
            conditionCode = `d < ${digit}`;
    }

    const code = `(function() {
        var digits = Bot.getLastDigitList().slice(-${digitsCount});
        var result = digits.length > 0 && digits.every(function(d) { return ${conditionCode}; });
        Bot.notify({
            className: 'journal__text--warn',
            message: '__ANALYSIS__' + JSON.stringify({
                type: 'analysis',
                condition: '${condition}',
                digit: ${digit},
                digits: digits,
                result: result
            }),
            sound: 'silent'
        });
        return result;
    })()`;

    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];
};
