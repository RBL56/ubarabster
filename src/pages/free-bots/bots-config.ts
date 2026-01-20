// Import XML files from the xml directory
import dalembertXml from '@/xml/dalembert.xml';
import dalembertMaxStakeXml from '@/xml/dalembert_max-stake.xml';
import locofxv2megamindXml from '@/xml/LOCOFX V2 MEGAMIND.xml';
import locospeedbotXml from '@/xml/locospeedbot.xml';
import martingaleXml from '@/xml/martingale.xml';
import martingaleMaxStakeXml from '@/xml/martingale_max-stake.xml';
import oscarsGrindXml from '@/xml/oscars_grind.xml';
import reverseDalembertXml from '@/xml/reverse_dalembert.xml';
import reverseMartingaleXml from '@/xml/reverse_martingale.xml';

export type TBotConfig = {
    id: string;
    name: string;
    description: string;
    xml: string;
    category?: string;
};

export const FREE_BOTS: TBotConfig[] = [
    {
        id: 'martingale',
        name: 'Martingale',
        description: 'Classic Martingale strategy - doubles stake after each loss',
        xml: martingaleXml,
        category: 'Classic',
    },
    {
        id: 'martingale_max_stake',
        name: 'Martingale (Max Stake)',
        description: 'Martingale strategy with maximum stake limit',
        xml: martingaleMaxStakeXml,
        category: 'Classic',
    },
    {
        id: 'dalembert',
        name: "D'Alembert",
        description: "D'Alembert strategy - increases stake by 1 after loss",
        xml: dalembertXml,
        category: 'Classic',
    },
    {
        id: 'dalembert_max_stake',
        name: "D'Alembert (Max Stake)",
        description: "D'Alembert strategy with maximum stake limit",
        xml: dalembertMaxStakeXml,
        category: 'Classic',
    },
    {
        id: 'reverse_dalembert',
        name: "Reverse D'Alembert",
        description: "Reverse D'Alembert - increases stake after wins",
        xml: reverseDalembertXml,
        category: 'Reverse',
    },
    {
        id: 'reverse_martingale',
        name: 'Reverse Martingale',
        description: 'Reverse Martingale - doubles stake after each win',
        xml: reverseMartingaleXml,
        category: 'Reverse',
    },
    {
        id: 'oscars_grind',
        name: "Oscar's Grind",
        description: "Oscar's Grind strategy - progressive betting system",
        xml: oscarsGrindXml,
        category: 'Progressive',
    },
    {
        id: 'locofx_v2_megamind',
        name: 'LOCOFX V2 MEGAMIND',
        description: 'Advanced automated trading strategy',
        xml: locofxv2megamindXml,
        category: 'Progressive',
    },
    {
        id: 'locospeedbot',
        name: 'LOCOSPEEDBOT',
        description: 'Advanced automated trading strategy',
        xml: locospeedbotXml,
        category: 'Progressive',
    },

    {
        id: 'locospeedbot',
        name: 'LOCOSPEEDBOT',
        description: 'Advanced automated trading strategy',
        xml: locospeedbotXml,
        category: 'Progressive',
    },
];
