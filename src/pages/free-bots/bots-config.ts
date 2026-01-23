import locofxv2megamindXml from '@/xml/LOCOFX V2 MEGAMIND.xml';
import locospeedbotXml from '@/xml/locospeedbot.xml';
import locoV15Xml from '@/xml/LOCO V1.5.xml';
import locoSpeedBotEntryXml from '@/xml/LOCO SPEED BOT WITH ENTRY .xml';
import entryPointBotOver2Xml from '@/xml/_Entry point Bot over 2.xml';

export type TBotConfig = {
    id: string;
    name: string;
    description: string;
    xml: string;
    category?: string;
};

export const FREE_BOTS: TBotConfig[] = [
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
        id: 'loco_v1_5',
        name: 'LOCO V1.5',
        description: 'Updated LOCO strategy for better performance',
        xml: locoV15Xml,
        category: 'Progressive',
    },
    {
        id: 'loco_speed_bot_entry',
        name: 'LOCO SPEED BOT WITH ENTRY',
        description: 'Fast trading bot with specific entry points',
        xml: locoSpeedBotEntryXml,
        category: 'Progressive',
    },
    {
        id: 'entry_point_bot_over_2',
        name: 'Entry point Bot over 2',
        description: 'Strategy focused on over 2 predictions',
        xml: entryPointBotOver2Xml,
        category: 'Progressive',
    },
];
