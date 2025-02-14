const commands = [
    {
        name: 'ctabot',
        description: 'CTA Bot commands',
        options: [{
            type: 1, 
            name: 'cancelcta',
            description: 'Cancel event',
            options: [{
                type: 3,
                name: 'id',
                description: 'Event ID',
                required: true
            }]
        },
        {
            type: 1, 
            name: 'prune',
            description: 'Remove people not in VC from the event',
            options: [{
                type: 3,
                name: 'eventid',
                description: 'Event ID',
                required: true
            }]
        },
        {
            type: 1, 
            name: 'missing',
            description: 'Ping people signed up for the event that are not in VC',
            options: [{
                type: 3,
                name: 'eventid',
                description: 'Event ID',
                required: true
            }]
        },
        {
            name: 'help',
            description: 'How to use CTA BOT',
            type: 1
        },
        {
            name: 'myctas',
            description: 'List of CTAs you are signed for',
            type: 1
        },
        {
            name: 'ocr',
            description: 'Recognize event from screenshot',
            type: 1,
            options: [
                {
                    name: 'image',
                    type: 11, // ATTACHMENT
                    description: 'The image to perform OCR on.',
                    required: true,
                },
            ],
        },
        {
            name: 'deletecomp',
            description: 'Delete existing comp',
            type: 1,
            options: [
                {
                    name: 'compname',
                    type: 3, // ATTACHMENT
                    description: 'Type in the name of the comp to delete',
                    required: true,
                    autocomplete: true,
                },
            ],
        },
        {
            type: 1, 
            name: 'newcomp',
            description: 'Create a new comp',
            options: [{
                type: 3,
                name: 'compname',
                description: 'Type in the name for the comp',
                required: true
            },
            {
                type: 3,
                name: 'comproles',
                description: 'Type in Roles in the comp separated by \`;\` (Example: 1H Mace; Hallowfall; Rift Glaive)',
                required: true
            },
        ]
        },
        {
            name: 'listcomps',
            type: 1,
            description: 'List all compositions or roles from a specific composition.',
            options: [
                {
                    name: 'comp',
                    type: 3, // STRING
                    description: 'Name of the composition (optional)',
                    required: false,
                    autocomplete: true,
                },
            ],
        },
        {
            type: 1,
            name: 'clearroles', 
            description: 'Free up listed roles (for example, if people are unavailable)',
            options: [{
                name: 'eventid',
                type: 3, // STRING
                description: 'Name of the event',
                required: true,
            },
            {
                name: 'roles',
                type: 3, // STRING
                description: 'List of roles to free up separated by commas (for example: 5,8,9,23)',
                required: true,
            }]
        },
        {
            type: 1, 
            name: 'newcta',
            description: 'Create new CTA event',
            options: [{
                name: 'eventname',
                type: 3, // STRING
                description: 'Name of the event',
                required: true,
            },
            {
                name: 'date',
                type: 3, // STRING
                description: 'Date of the event in DD.MM.YYYY format',
                required: true,
            },
            {
                name: 'time',
                type: 3, // STRING
                description: 'Time in HH:MM format',
                required: true,
            },
            {
                name: 'comp',
                type: 3, // STRING
                description: 'Composition name',
                required: true,
                autocomplete: true,
            }],
        }, 
        {
            type: 1, 
            name: 'editcta',
            description: 'Edit title/date/time for existing event',
            options: [{
                name: 'eventid',
                type: 3, // STRING
                description: 'Event ID',
                required: true,
            },
            {
                name: 'eventname',
                type: 3, // STRING
                description: 'Name of the event',
                required: false,
            },
            {
                name: 'date',
                type: 3, // STRING
                description: 'Date of the event in DD.MM.YYYY format',
                required: false,
            },
            {
                name: 'time',
                type: 3, // STRING
                description: 'Time in HH:MM format',
                required: false,
            }],
        }]
    },
];

export { commands };