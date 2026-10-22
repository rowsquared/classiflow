// What the demo records are made of: labour force survey answers to "What is
// your main job?", "What are your main tasks or duties?" and "What does the
// place where you work mainly do or make?". Each profile is one occupation
// (ISCO-08 unit group) with ways people name it, describe the work and the
// workplace; each workplace carries its ISIC Rev.4 division. The generator in
// scripts/seed-demo.ts combines and roughens them (lower case, typos, missing
// answers), so the same profile yields many different records.

export type Profile = {
  isco: string
  titles: string[]
  tasks: string[]
  places: Array<[isic: string, text: string]>
  /** Share of answers given as self-employed rather than employee. */
  selfEmployed?: number
}

export const PROFILES: Profile[] = [
  // 1 Managers
  {
    isco: '1120',
    titles: ['managing director', 'CEO', 'general manager of the company'],
    tasks: ['runs the company, reports to the board', 'sets strategy and budgets, oversees all departments'],
    places: [
      ['46', 'wholesale of building materials'],
      ['10', 'food processing company'],
      ['62', 'software company']
    ]
  },
  {
    isco: '1211',
    titles: ['finance manager', 'head of finance', 'chief financial officer'],
    tasks: [
      'manages the finance department, prepares budgets and financial reports',
      'oversees accounting staff and cash flow'
    ],
    places: [
      ['64', 'commercial bank'],
      ['47', 'supermarket chain head office'],
      ['86', 'private hospital group']
    ]
  },
  {
    isco: '1212',
    titles: ['HR manager', 'human resources manager', 'head of personnel'],
    tasks: ['recruits staff, handles contracts and staff complaints', 'leads the HR team, plans training and salaries'],
    places: [
      ['49', 'bus company'],
      ['24', 'steel plant'],
      ['84', 'ministry of labour']
    ]
  },
  {
    isco: '1221',
    titles: ['sales manager', 'marketing manager', 'regional sales manager'],
    tasks: ['leads a team of sales reps and sets targets', 'plans marketing campaigns and product prices'],
    places: [
      ['11', 'brewery'],
      ['20', 'paint and chemicals manufacturer'],
      ['61', 'mobile phone operator']
    ]
  },
  {
    isco: '1321',
    titles: ['production manager', 'factory manager', 'plant manager'],
    tasks: [
      'plans production and supervises the shift leaders',
      'responsible for output, quality and safety in the factory'
    ],
    places: [
      ['22', 'plastic packaging factory'],
      ['14', 'garment factory'],
      ['10', 'dairy processing plant']
    ]
  },
  {
    isco: '1323',
    titles: ['construction manager', 'site manager', 'project manager construction'],
    tasks: ['manages building projects, contractors and schedules', 'plans and controls work on construction sites'],
    places: [
      ['41', 'construction company building houses'],
      ['42', 'road construction company']
    ]
  },
  {
    isco: '1324',
    titles: ['logistics manager', 'warehouse manager', 'supply chain manager'],
    tasks: ['manages the warehouse and deliveries', 'plans purchasing, stock levels and transport'],
    places: [
      ['52', 'logistics and storage company'],
      ['46', 'food wholesaler'],
      ['47', 'retail chain distribution centre']
    ]
  },
  {
    isco: '1330',
    titles: ['IT manager', 'head of IT', 'ICT manager'],
    tasks: ['manages the IT department and the network', 'plans IT systems and leads the support team'],
    places: [
      ['64', 'bank'],
      ['84', 'district administration'],
      ['85', 'university']
    ]
  },
  {
    isco: '1345',
    titles: ['school principal', 'head teacher', 'headmistress'],
    tasks: [
      'manages the school, the teachers and the budget',
      'runs the school and meets parents and the education office'
    ],
    places: [
      ['85', 'public primary school'],
      ['85', 'private secondary school']
    ]
  },
  {
    isco: '1342',
    titles: ['hospital manager', 'clinic manager', 'health facility administrator'],
    tasks: ['manages the hospital staff and budget', 'runs the clinic and reports to the health ministry'],
    places: [
      ['86', 'district hospital'],
      ['86', 'private clinic']
    ]
  },
  {
    isco: '1411',
    titles: ['hotel manager', 'guesthouse manager'],
    tasks: [
      'runs the hotel, staff rota, bookings and complaints',
      'manages reception, housekeeping and the restaurant'
    ],
    places: [
      ['55', 'hotel'],
      ['55', 'lodge for tourists']
    ],
    selfEmployed: 0.2
  },
  {
    isco: '1412',
    titles: ['restaurant manager', 'manager of a restaurant'],
    tasks: [
      'manages the restaurant, orders food and supervises waiters',
      'plans shifts and checks the kitchen and service'
    ],
    places: [
      ['56', 'restaurant'],
      ['56', 'fast food outlet']
    ],
    selfEmployed: 0.3
  },
  {
    isco: '1420',
    titles: ['shop manager', 'store manager', 'branch manager supermarket'],
    tasks: ['manages the shop, staff and stock', 'responsible for sales, orders and cashiers in the store'],
    places: [
      ['47', 'supermarket'],
      ['47', 'clothing store'],
      ['46', 'wholesale shop for hardware']
    ],
    selfEmployed: 0.25
  },
  {
    isco: '1311',
    titles: ['farm manager', 'plantation manager'],
    tasks: ['manages the farm workers and the harvest', 'plans planting, spraying and sale of crops'],
    places: [
      ['01', 'tea estate'],
      ['01', 'commercial maize farm']
    ]
  },

  // 2 Professionals
  {
    isco: '2120',
    titles: ['statistician', 'data analyst (statistics)', 'survey statistician'],
    tasks: ['designs surveys and analyses the data', 'calculates indicators and writes statistical reports'],
    places: [
      ['84', 'national statistics office'],
      ['72', 'research institute'],
      ['85', 'university']
    ]
  },
  {
    isco: '2142',
    titles: ['civil engineer', 'structural engineer', 'site engineer'],
    tasks: ['designs roads and bridges, checks the calculations', 'supervises construction works and checks quality'],
    places: [
      ['71', 'engineering consultancy'],
      ['42', 'road construction company'],
      ['84', 'ministry of public works']
    ]
  },
  {
    isco: '2144',
    titles: ['mechanical engineer', 'maintenance engineer'],
    tasks: ['designs machine parts and supervises maintenance', 'plans repairs of the production machines'],
    places: [
      ['28', 'machinery manufacturer'],
      ['10', 'sugar factory'],
      ['35', 'power station']
    ]
  },
  {
    isco: '2151',
    titles: ['electrical engineer', 'power engineer'],
    tasks: [
      'designs electrical installations and checks the grid',
      'plans the electricity network and supervises technicians'
    ],
    places: [
      ['35', 'electricity company'],
      ['71', 'engineering firm']
    ]
  },
  {
    isco: '2161',
    titles: ['architect', 'building architect'],
    tasks: ['designs houses and office buildings, draws plans', 'prepares building designs and meets clients'],
    places: [['71', 'architecture office']],
    selfEmployed: 0.3
  },
  {
    isco: '2166',
    titles: ['graphic designer', 'web designer (graphics)', 'layout designer'],
    tasks: ['designs logos, posters and adverts on the computer', 'makes designs for packaging and social media'],
    places: [
      ['73', 'advertising agency'],
      ['58', 'magazine publisher'],
      ['18', 'printing company']
    ],
    selfEmployed: 0.4
  },
  {
    isco: '2211',
    titles: ['medical doctor', 'general practitioner', 'GP', 'doctor'],
    tasks: ['examines and treats patients, prescribes medicine', 'sees patients in the outpatient department'],
    places: [
      ['86', 'health centre'],
      ['86', 'district hospital'],
      ['86', 'private practice']
    ],
    selfEmployed: 0.15
  },
  {
    isco: '2212',
    titles: ['surgeon', 'paediatrician', 'gynaecologist', 'specialist doctor'],
    tasks: ['performs operations and follows up patients', 'treats children in the paediatric ward'],
    places: [
      ['86', 'referral hospital'],
      ['86', 'university hospital']
    ]
  },
  {
    isco: '2221',
    titles: ['registered nurse', 'nurse', 'staff nurse', 'nursing officer'],
    tasks: [
      'cares for patients on the ward, gives injections and medication',
      'checks vital signs, dresses wounds and assists doctors'
    ],
    places: [
      ['86', 'public hospital'],
      ['86', 'health centre'],
      ['87', 'nursing home for the elderly']
    ]
  },
  {
    isco: '2222',
    titles: ['midwife', 'nurse midwife'],
    tasks: ['assists women in childbirth and does antenatal checks', 'delivers babies and advises mothers'],
    places: [
      ['86', 'maternity hospital'],
      ['86', 'health centre']
    ]
  },
  {
    isco: '2262',
    titles: ['pharmacist', 'chemist (pharmacy)'],
    tasks: ['dispenses medicine and advises customers', 'checks prescriptions and manages the pharmacy stock'],
    places: [
      ['47', 'pharmacy'],
      ['86', 'hospital pharmacy']
    ],
    selfEmployed: 0.2
  },
  {
    isco: '2261',
    titles: ['dentist', 'dental surgeon'],
    tasks: ['treats teeth, fillings and extractions', 'examines patients and does dental surgery'],
    places: [['86', 'dental clinic']],
    selfEmployed: 0.4
  },
  {
    isco: '2310',
    titles: ['university lecturer', 'professor', 'lecturer'],
    tasks: ['teaches students and does research', 'gives lectures, supervises theses and marks exams'],
    places: [
      ['85', 'public university'],
      ['85', 'technical college']
    ]
  },
  {
    isco: '2320',
    titles: ['vocational teacher', 'instructor at technical school', 'TVET trainer'],
    tasks: ['teaches welding and metalwork to students', 'trains apprentices in motor mechanics'],
    places: [
      ['85', 'vocational training centre'],
      ['85', 'technical institute']
    ]
  },
  {
    isco: '2330',
    titles: ['secondary school teacher', 'high school teacher', 'maths teacher', 'teacher of biology'],
    tasks: ['teaches mathematics and physics to forms 1 to 4', 'prepares lessons, teaches and marks exams'],
    places: [
      ['85', 'public secondary school'],
      ['85', 'private high school']
    ]
  },
  {
    isco: '2341',
    titles: ['primary school teacher', 'teacher', 'class teacher grade 3'],
    tasks: ['teaches all subjects to grade 3 pupils', 'teaches reading and writing to young children'],
    places: [
      ['85', 'primary school'],
      ['85', 'government primary school']
    ]
  },
  {
    isco: '2342',
    titles: ['nursery teacher', 'pre-school teacher', 'kindergarten teacher'],
    tasks: ['teaches and plays with children aged 3 to 5', 'prepares activities for small children'],
    places: [
      ['85', 'kindergarten'],
      ['85', 'nursery school']
    ]
  },
  {
    isco: '2411',
    titles: ['accountant', 'chartered accountant', 'auditor'],
    tasks: ['prepares the accounts and tax returns', 'audits financial statements of clients'],
    places: [
      ['69', 'accounting firm'],
      ['64', 'bank'],
      ['10', 'food company']
    ],
    selfEmployed: 0.15
  },
  {
    isco: '2421',
    titles: ['management consultant', 'business analyst', 'organisational development consultant'],
    tasks: [
      'advises companies on processes and restructuring',
      'analyses business processes and writes recommendations'
    ],
    places: [['70', 'consulting firm']],
    selfEmployed: 0.3
  },
  {
    isco: '2422',
    titles: ['policy officer', 'programme officer', 'policy analyst'],
    tasks: ['drafts policies and monitors programmes', 'prepares briefs for the minister'],
    places: [
      ['84', 'ministry of health'],
      ['94', 'non-governmental organisation'],
      ['99', 'UN agency']
    ]
  },
  {
    isco: '2431',
    titles: ['marketing officer', 'digital marketing specialist', 'brand manager'],
    tasks: ['plans adverts and social media campaigns', 'does market research and promotes products'],
    places: [
      ['73', 'marketing agency'],
      ['11', 'soft drink company'],
      ['61', 'telecom company']
    ]
  },
  {
    isco: '2512',
    titles: ['software developer', 'software engineer', 'programmer', 'backend developer'],
    tasks: ['writes code for web applications', 'develops and tests software for clients'],
    places: [
      ['62', 'software company'],
      ['64', 'bank IT department'],
      ['63', 'online platform']
    ],
    selfEmployed: 0.15
  },
  {
    isco: '2513',
    titles: ['web developer', 'frontend developer', 'website designer'],
    tasks: ['builds websites and online shops', 'develops web pages and fixes bugs'],
    places: [
      ['62', 'web agency'],
      ['73', 'digital marketing agency']
    ],
    selfEmployed: 0.35
  },
  {
    isco: '2522',
    titles: ['system administrator', 'sysadmin', 'IT administrator'],
    tasks: ['maintains servers and user accounts', 'installs updates, backups and monitors the systems'],
    places: [
      ['62', 'IT services company'],
      ['84', 'tax authority'],
      ['85', 'university']
    ]
  },
  {
    isco: '2611',
    titles: ['lawyer', 'advocate', 'attorney'],
    tasks: ['represents clients in court and drafts contracts', 'gives legal advice to companies'],
    places: [['69', 'law firm']],
    selfEmployed: 0.35
  },
  {
    isco: '2635',
    titles: ['social worker', 'counsellor', 'case worker'],
    tasks: ['supports families and children at risk', 'counsels clients and makes home visits'],
    places: [
      ['88', 'social welfare office'],
      ['88', 'charity for street children'],
      ['84', 'department of social development']
    ]
  },
  {
    isco: '2642',
    titles: ['journalist', 'reporter', 'news editor'],
    tasks: ['writes news articles and interviews people', 'reports on politics for the newspaper'],
    places: [
      ['58', 'daily newspaper'],
      ['60', 'radio station'],
      ['63', 'online news site']
    ],
    selfEmployed: 0.2
  },
  {
    isco: '2643',
    titles: ['translator', 'interpreter'],
    tasks: ['translates documents from English to French', 'interprets at meetings and conferences'],
    places: [
      ['74', 'translation agency'],
      ['99', 'international organisation']
    ],
    selfEmployed: 0.5
  },
  {
    isco: '2652',
    titles: ['musician', 'singer', 'guitarist in a band'],
    tasks: ['plays music at weddings and events', 'sings and records songs'],
    places: [
      ['90', 'music band'],
      ['90', 'own music business']
    ],
    selfEmployed: 0.8
  },

  // 3 Technicians and associate professionals
  {
    isco: '3112',
    titles: ['civil engineering technician', 'surveying technician', 'quantity surveyor assistant'],
    tasks: ['measures sites and prepares drawings for engineers', 'tests concrete and soil samples'],
    places: [
      ['71', 'engineering consultancy'],
      ['42', 'construction company']
    ]
  },
  {
    isco: '3113',
    titles: ['electrical technician', 'electrical engineering technician'],
    tasks: ['installs and tests electrical equipment in substations', 'maintains transformers and control panels'],
    places: [
      ['35', 'electricity distribution company'],
      ['33', 'electrical repair company']
    ]
  },
  {
    isco: '3115',
    titles: ['mechanical technician', 'maintenance technician'],
    tasks: ['repairs and services production machines', 'does preventive maintenance on pumps and motors'],
    places: [
      ['10', 'flour mill'],
      ['23', 'cement factory'],
      ['33', 'machinery repair company']
    ]
  },
  {
    isco: '3122',
    titles: ['production supervisor', 'shift supervisor', 'line leader'],
    tasks: ['supervises workers on the production line', 'checks output and quality during the shift'],
    places: [
      ['14', 'garment factory'],
      ['10', 'meat processing plant'],
      ['29', 'car parts factory']
    ]
  },
  {
    isco: '3123',
    titles: ['construction foreman', 'site supervisor', 'foreman'],
    tasks: ['supervises masons and labourers on site', 'organises daily work on the building site'],
    places: [
      ['41', 'building contractor'],
      ['42', 'road works company']
    ]
  },
  {
    isco: '3212',
    titles: ['lab technician', 'medical laboratory technician', 'laboratory scientist'],
    tasks: ['tests blood and urine samples', 'runs malaria and HIV tests in the lab'],
    places: [
      ['86', 'hospital laboratory'],
      ['86', 'private diagnostic lab']
    ]
  },
  {
    isco: '3213',
    titles: ['pharmacy technician', 'pharmacy assistant', 'dispenser'],
    tasks: ['prepares and dispenses medicines under a pharmacist', 'sells medicine and keeps the pharmacy stock'],
    places: [
      ['47', 'pharmacy'],
      ['86', 'hospital pharmacy']
    ]
  },
  {
    isco: '3221',
    titles: ['enrolled nurse', 'nurse assistant (enrolled)', 'auxiliary nurse'],
    tasks: ['assists registered nurses with patient care', 'takes temperatures and gives basic care on the ward'],
    places: [
      ['86', 'hospital'],
      ['87', 'care home']
    ]
  },
  {
    isco: '3253',
    titles: ['community health worker', 'village health worker', 'health promoter'],
    tasks: [
      'visits households to give health education and refer sick people',
      'checks children for malnutrition and promotes vaccination'
    ],
    places: [
      ['86', 'health centre outreach'],
      ['94', 'NGO health project'],
      ['84', 'district health office']
    ]
  },
  {
    isco: '3258',
    titles: ['paramedic', 'ambulance driver and EMT', 'emergency medical technician'],
    tasks: ['gives first aid and takes patients to hospital', 'responds to emergency calls with the ambulance'],
    places: [
      ['86', 'ambulance service'],
      ['84', 'fire and rescue service']
    ]
  },
  {
    isco: '3313',
    titles: ['accounting assistant', 'accounts officer', 'junior accountant'],
    tasks: ['posts entries, reconciles bank statements', 'prepares invoices and monthly reports for the accountant'],
    places: [
      ['69', 'accounting firm'],
      ['47', 'retail company'],
      ['86', 'hospital']
    ]
  },
  {
    isco: '3312',
    titles: ['loan officer', 'credit officer', 'microfinance officer'],
    tasks: ['assesses loan applications and visits clients', 'collects repayments from groups of borrowers'],
    places: [
      ['64', 'microfinance institution'],
      ['64', 'savings and credit cooperative']
    ]
  },
  {
    isco: '3322',
    titles: ['sales representative', 'sales rep', 'field sales agent'],
    tasks: ['visits shops to sell products and take orders', 'sells medical supplies to clinics'],
    places: [
      ['46', 'beverage distributor'],
      ['46', 'pharmaceutical wholesaler'],
      ['20', 'cosmetics manufacturer']
    ]
  },
  {
    isco: '3321',
    titles: ['insurance agent', 'insurance sales agent'],
    tasks: ['sells life and car insurance policies', 'advises clients and collects premiums'],
    places: [
      ['65', 'insurance company'],
      ['66', 'insurance brokerage']
    ],
    selfEmployed: 0.3
  },
  {
    isco: '3334',
    titles: ['real estate agent', 'estate agent', 'property manager'],
    tasks: ['shows houses to buyers and tenants', 'manages rental flats and collects rent'],
    places: [['68', 'real estate agency']],
    selfEmployed: 0.4
  },
  {
    isco: '3343',
    titles: ['executive secretary', 'personal assistant', 'administrative assistant'],
    tasks: ["manages the director's diary and correspondence", 'organises meetings, travel and files'],
    places: [
      ['70', 'company head office'],
      ['84', 'ministry of finance'],
      ['99', 'embassy']
    ]
  },
  {
    isco: '3352',
    titles: ['tax officer', 'revenue officer', 'tax inspector'],
    tasks: ['checks tax returns and collects taxes', 'audits businesses for tax compliance'],
    places: [['84', 'revenue authority']]
  },
  {
    isco: '3355',
    titles: ['police inspector', 'detective', 'criminal investigator'],
    tasks: ['investigates crimes and interviews suspects', 'leads investigations at the police station'],
    places: [['84', 'national police']]
  },
  {
    isco: '3412',
    titles: ['social welfare assistant', 'community development assistant', 'youth worker'],
    tasks: ['helps run youth programmes and visits families', 'registers beneficiaries for social programmes'],
    places: [
      ['88', 'community centre'],
      ['94', 'NGO'],
      ['84', 'municipality social services']
    ]
  },
  {
    isco: '3422',
    titles: ['football coach', 'sports coach', 'swimming instructor'],
    tasks: ['trains the youth football team', 'teaches swimming to children and adults'],
    places: [
      ['93', 'sports club'],
      ['85', 'school sports department']
    ],
    selfEmployed: 0.3
  },
  {
    isco: '3434',
    titles: ['chef', 'head chef', 'sous chef'],
    tasks: ['plans the menu and leads the kitchen team', 'prepares main dishes and supervises cooks'],
    places: [
      ['56', 'restaurant'],
      ['55', 'hotel restaurant']
    ]
  },
  {
    isco: '3512',
    titles: ['IT support technician', 'helpdesk officer', 'IT technician'],
    tasks: ['fixes computers and printers for staff', 'answers user calls and resets passwords'],
    places: [
      ['62', 'IT services company'],
      ['85', 'university'],
      ['84', 'county government']
    ]
  },
  {
    isco: '3513',
    titles: ['network technician', 'network engineer (junior)'],
    tasks: ['installs network cables, routers and switches', 'maintains the office network and wifi'],
    places: [
      ['61', 'internet service provider'],
      ['62', 'IT company']
    ]
  },
  {
    isco: '3521',
    titles: ['sound technician', 'camera operator', 'video editor'],
    tasks: ['records and edits video for TV programmes', 'sets up sound equipment for events'],
    places: [
      ['60', 'television station'],
      ['59', 'film production company'],
      ['90', 'events company']
    ],
    selfEmployed: 0.35
  },

  // 4 Clerical support workers
  {
    isco: '4110',
    titles: ['office clerk', 'clerk', 'administrative clerk', 'office assistant'],
    tasks: ['files documents, makes copies and answers the phone', 'types letters and keeps records'],
    places: [
      ['84', 'district office'],
      ['69', 'law firm'],
      ['85', 'school office']
    ]
  },
  {
    isco: '4120',
    titles: ['secretary', 'typist secretary', 'office secretary'],
    tasks: ['types letters, answers calls and keeps the diary', 'receives visitors and writes minutes'],
    places: [
      ['85', 'secondary school'],
      ['86', 'clinic'],
      ['94', 'church office']
    ]
  },
  {
    isco: '4132',
    titles: ['data entry clerk', 'data clerk', 'data capturer'],
    tasks: ['enters survey questionnaires into the computer', 'types customer data into the system'],
    places: [
      ['84', 'statistics office'],
      ['82', 'call centre and back office company'],
      ['64', 'bank']
    ]
  },
  {
    isco: '4211',
    titles: ['bank teller', 'cashier at the bank', 'teller'],
    tasks: ['receives deposits and pays out cash to customers', 'serves customers at the counter'],
    places: [
      ['64', 'commercial bank'],
      ['64', 'savings bank']
    ]
  },
  {
    isco: '4222',
    titles: ['call centre agent', 'customer service agent', 'customer care representative'],
    tasks: ['answers customer calls and solves complaints', 'helps customers on the phone with their accounts'],
    places: [
      ['82', 'call centre'],
      ['61', 'mobile network operator'],
      ['35', 'electricity company']
    ]
  },
  {
    isco: '4224',
    titles: ['hotel receptionist', 'front desk agent', 'front office clerk'],
    tasks: ['checks guests in and out, takes bookings', 'welcomes guests and handles room keys and payments'],
    places: [
      ['55', 'hotel'],
      ['55', 'guest house']
    ]
  },
  {
    isco: '4226',
    titles: ['receptionist', 'front desk receptionist'],
    tasks: ['receives visitors and answers the switchboard', 'books appointments for patients'],
    places: [
      ['86', 'dental clinic'],
      ['70', 'office building company'],
      ['69', 'law firm']
    ]
  },
  {
    isco: '4227',
    titles: ['survey interviewer', 'enumerator', 'field interviewer'],
    tasks: ['interviews households with a tablet', 'collects data door to door for the census'],
    places: [
      ['84', 'national statistics office'],
      ['73', 'market research company']
    ]
  },
  {
    isco: '4311',
    titles: ['bookkeeper', 'accounts clerk', 'bookkeeping clerk'],
    tasks: ['records sales and expenses in the books', 'keeps the cash book and prepares payments'],
    places: [
      ['47', 'hardware shop'],
      ['41', 'building company'],
      ['94', 'cooperative']
    ]
  },
  {
    isco: '4313',
    titles: ['payroll clerk', 'payroll officer', 'salary clerk'],
    tasks: ['calculates salaries and deductions', 'prepares the monthly payroll'],
    places: [
      ['84', 'county government'],
      ['78', 'staffing agency'],
      ['10', 'food factory']
    ]
  },
  {
    isco: '4321',
    titles: ['storekeeper', 'stock clerk', 'store clerk'],
    tasks: ['receives goods and records stock in the store', 'issues materials and counts stock'],
    places: [
      ['52', 'warehouse'],
      ['86', 'hospital stores'],
      ['41', 'construction company']
    ]
  },
  {
    isco: '4323',
    titles: ['transport clerk', 'dispatcher', 'fleet clerk'],
    tasks: ['schedules trucks and drivers', 'records deliveries and issues waybills'],
    places: [
      ['49', 'trucking company'],
      ['53', 'courier company']
    ]
  },
  {
    isco: '4412',
    titles: ['postman', 'mail carrier', 'mail sorter'],
    tasks: ['delivers letters and parcels', 'sorts mail at the post office'],
    places: [['53', 'post office']]
  },

  // 5 Service and sales workers
  {
    isco: '5111',
    titles: ['flight attendant', 'cabin crew', 'air hostess'],
    tasks: ['serves passengers and explains safety on the plane', 'looks after passengers during flights'],
    places: [['51', 'airline']]
  },
  {
    isco: '5113',
    titles: ['tour guide', 'safari guide', 'travel guide'],
    tasks: ['takes tourists around and explains the sites', 'guides visitors in the national park'],
    places: [
      ['79', 'tour operator'],
      ['91', 'national park']
    ],
    selfEmployed: 0.35
  },
  {
    isco: '5120',
    titles: ['cook', 'kitchen cook', 'line cook', 'cook in canteen'],
    tasks: ['cooks meals for customers', 'prepares food in the kitchen, rice, meat and stew'],
    places: [
      ['56', 'restaurant'],
      ['56', 'school canteen caterer'],
      ['55', 'hotel kitchen']
    ]
  },
  {
    isco: '5131',
    titles: ['waiter', 'waitress', 'server'],
    tasks: ['takes orders and serves food to customers', 'serves tables and clears plates'],
    places: [
      ['56', 'restaurant'],
      ['56', 'cafe'],
      ['55', 'hotel restaurant']
    ]
  },
  {
    isco: '5132',
    titles: ['bartender', 'barman', 'barmaid'],
    tasks: ['serves drinks at the bar', 'mixes drinks and takes payment'],
    places: [
      ['56', 'bar'],
      ['56', 'night club'],
      ['55', 'hotel bar']
    ]
  },
  {
    isco: '5141',
    titles: ['hairdresser', 'barber', 'hair stylist'],
    tasks: ['cuts and styles hair', 'braids hair and sells hair products'],
    places: [
      ['96', 'hair salon'],
      ['96', 'barber shop']
    ],
    selfEmployed: 0.6
  },
  {
    isco: '5142',
    titles: ['beautician', 'nail technician', 'beauty therapist'],
    tasks: ['does manicure, pedicure and make-up', 'gives facials and massages'],
    places: [
      ['96', 'beauty salon'],
      ['96', 'spa']
    ],
    selfEmployed: 0.55
  },
  {
    isco: '5152',
    titles: ['housekeeper', 'domestic housekeeper'],
    tasks: ['runs the household, supervises the maid and gardener', 'manages cooking and cleaning in a private house'],
    places: [['97', 'private household']]
  },
  {
    isco: '5153',
    titles: ['caretaker', 'janitor', 'building caretaker'],
    tasks: ['looks after the apartment building and small repairs', 'opens the building and keeps it clean'],
    places: [
      ['68', 'property management company'],
      ['85', 'school']
    ]
  },
  {
    isco: '5211',
    titles: ['market vendor', 'market trader', 'stall holder'],
    tasks: ['sells vegetables at the market', 'sells second-hand clothes at the market stall'],
    places: [
      ['47', 'own market stall'],
      ['47', 'open market']
    ],
    selfEmployed: 0.9
  },
  {
    isco: '5212',
    titles: ['street food vendor', 'food hawker', 'sells chapati by the road'],
    tasks: ['cooks and sells snacks by the roadside', 'sells roasted maize and tea to passers-by'],
    places: [
      ['56', 'own food stand'],
      ['56', 'roadside kiosk']
    ],
    selfEmployed: 0.95
  },
  {
    isco: '5221',
    titles: ['shopkeeper', 'shop owner', 'kiosk owner'],
    tasks: ['runs a small grocery shop and buys stock', 'sells airtime, soap and sugar in own shop'],
    places: [
      ['47', 'own shop'],
      ['47', 'kiosk']
    ],
    selfEmployed: 0.9
  },
  {
    isco: '5222',
    titles: ['shop supervisor', 'floor supervisor', 'section supervisor in supermarket'],
    tasks: ['supervises sales staff and checks the shelves', 'organises shifts and handles complaints'],
    places: [
      ['47', 'supermarket'],
      ['47', 'department store']
    ]
  },
  {
    isco: '5223',
    titles: ['shop assistant', 'sales assistant', 'sales lady', 'shop attendant'],
    tasks: ['serves customers and arranges goods on shelves', 'sells clothes and helps customers'],
    places: [
      ['47', 'clothing shop'],
      ['47', 'supermarket'],
      ['47', 'electronics shop']
    ]
  },
  {
    isco: '5230',
    titles: ['cashier', 'till operator', 'checkout cashier'],
    tasks: ['scans goods and takes payment at the till', 'receives money from customers'],
    places: [
      ['47', 'supermarket'],
      ['47', 'petrol station shop'],
      ['56', 'fast food restaurant']
    ]
  },
  {
    isco: '5245',
    titles: ['petrol attendant', 'pump attendant', 'fuel attendant'],
    tasks: ['fills cars with fuel and takes payment', 'serves fuel and checks tyre pressure'],
    places: [['47', 'petrol station']]
  },
  {
    isco: '5246',
    titles: ['counter attendant', 'canteen server', 'counter staff'],
    tasks: ['serves food at the counter', 'hands out meals in the canteen'],
    places: [
      ['56', 'fast food restaurant'],
      ['56', 'staff canteen']
    ]
  },
  {
    isco: '5311',
    titles: ['child minder', 'nanny', 'day care worker'],
    tasks: ['looks after children during the day', 'feeds and plays with babies at the day care'],
    places: [
      ['88', 'day care centre'],
      ['97', 'private household']
    ],
    selfEmployed: 0.3
  },
  {
    isco: '5312',
    titles: ['teacher aide', 'teaching assistant', 'classroom assistant'],
    tasks: ['helps the teacher in class with children', 'supports pupils with reading'],
    places: [['85', 'primary school']]
  },
  {
    isco: '5321',
    titles: ['nursing aide', 'health care assistant', 'patient attendant'],
    tasks: ['washes and feeds patients, changes beds', 'helps nurses with patients on the ward'],
    places: [
      ['86', 'hospital'],
      ['87', 'care home for the elderly']
    ]
  },
  {
    isco: '5322',
    titles: ['home care worker', 'caregiver', 'home-based carer'],
    tasks: ['cares for an old person at home, bathing and cooking', 'visits sick people at home and helps them'],
    places: [
      ['88', 'home care agency'],
      ['97', 'private household']
    ]
  },
  {
    isco: '5411',
    titles: ['firefighter', 'fireman'],
    tasks: ['puts out fires and rescues people', 'responds to fires and accidents'],
    places: [
      ['84', 'fire brigade'],
      ['52', 'airport fire service']
    ]
  },
  {
    isco: '5412',
    titles: ['police officer', 'police constable', 'policeman', 'traffic police'],
    tasks: ['patrols the streets and keeps order', 'controls traffic and checks vehicles'],
    places: [['84', 'police service']]
  },
  {
    isco: '5413',
    titles: ['prison warder', 'prison officer', 'correctional officer'],
    tasks: ['guards prisoners and supervises the cells', 'escorts prisoners to court'],
    places: [['84', 'prison service']]
  },
  {
    isco: '5414',
    titles: ['security guard', 'watchman', 'askari', 'night guard'],
    tasks: ['guards the gate and checks visitors', 'patrols the premises at night'],
    places: [
      ['80', 'security company'],
      ['47', 'shopping mall'],
      ['64', 'bank']
    ]
  },

  // 6 Skilled agricultural, forestry and fishery workers
  {
    isco: '6111',
    titles: ['farmer', 'vegetable farmer', 'maize farmer', 'crop farmer'],
    tasks: ['grows maize and beans and sells at the market', 'plants, weeds and harvests tomatoes for sale'],
    places: [
      ['01', 'own farm'],
      ['01', 'family farm']
    ],
    selfEmployed: 0.85
  },
  {
    isco: '6112',
    titles: ['coffee farmer', 'fruit grower', 'tea grower'],
    tasks: ['grows coffee and sells to the cooperative', 'looks after mango and avocado trees'],
    places: [
      ['01', 'own coffee farm'],
      ['01', 'tea smallholding']
    ],
    selfEmployed: 0.85
  },
  {
    isco: '6113',
    titles: ['gardener', 'landscape gardener', 'nursery grower'],
    tasks: ['grows flowers and seedlings for sale', 'plants and maintains gardens'],
    places: [
      ['01', 'plant nursery'],
      ['81', 'landscaping company'],
      ['97', 'private household']
    ],
    selfEmployed: 0.4
  },
  {
    isco: '6121',
    titles: ['dairy farmer', 'cattle farmer', 'livestock keeper'],
    tasks: ['keeps dairy cows and sells milk', 'rears cattle and goats for sale'],
    places: [
      ['01', 'own dairy farm'],
      ['01', 'ranch']
    ],
    selfEmployed: 0.8
  },
  {
    isco: '6122',
    titles: ['poultry farmer', 'chicken farmer'],
    tasks: ['keeps layers and sells eggs', 'raises broilers for the market'],
    places: [['01', 'own poultry farm']],
    selfEmployed: 0.8
  },
  {
    isco: '6130',
    titles: ['mixed farmer', 'farmer (crops and animals)'],
    tasks: ['grows maize and keeps cows and goats, sells milk and maize', 'farms crops and livestock for sale'],
    places: [['01', 'own farm']],
    selfEmployed: 0.85
  },
  {
    isco: '6222',
    titles: ['fisherman', 'fisher', 'lake fisherman'],
    tasks: ['catches fish on the lake with nets and sells them', 'goes fishing in a small boat and sells the catch'],
    places: [
      ['03', 'own fishing boat'],
      ['03', 'fishing on the lake']
    ],
    selfEmployed: 0.8
  },
  {
    isco: '6310',
    titles: ['subsistence farmer', 'farming for the family', 'small farmer'],
    tasks: ['grows cassava and beans for the family to eat', 'farms for home consumption, sells a little extra'],
    places: [
      ['01', 'family plot'],
      ['01', 'own shamba']
    ],
    selfEmployed: 0.95
  },
  {
    isco: '6210',
    titles: ['forestry worker (skilled)', 'tree feller', 'forest ranger assistant'],
    tasks: ['plants and fells trees in the forest', 'cuts timber and manages the plantation'],
    places: [
      ['02', 'forestry company'],
      ['02', 'forest plantation']
    ]
  },

  // 7 Craft and related trades workers
  {
    isco: '7112',
    titles: ['mason', 'bricklayer', 'fundi wa mawe'],
    tasks: ['lays bricks and blocks for houses', 'builds walls and plasters'],
    places: [
      ['41', 'building contractor'],
      ['41', 'building houses for private clients']
    ],
    selfEmployed: 0.5
  },
  {
    isco: '7115',
    titles: ['carpenter', 'joiner', 'roof carpenter'],
    tasks: ['makes roof trusses, doors and window frames', 'does carpentry work on building sites'],
    places: [
      ['41', 'construction company'],
      ['43', 'carpentry contractor']
    ],
    selfEmployed: 0.5
  },
  {
    isco: '7122',
    titles: ['tiler', 'floor layer', 'tile fixer'],
    tasks: ['fixes floor and wall tiles in houses', 'lays tiles in bathrooms and kitchens'],
    places: [['43', 'finishing contractor']],
    selfEmployed: 0.6
  },
  {
    isco: '7126',
    titles: ['plumber', 'pipe fitter'],
    tasks: ['installs and repairs water pipes and toilets', 'fixes leaking taps and drains'],
    places: [
      ['43', 'plumbing contractor'],
      ['36', 'water utility']
    ],
    selfEmployed: 0.55
  },
  {
    isco: '7131',
    titles: ['painter', 'house painter', 'painter and decorator'],
    tasks: ['paints walls and ceilings of buildings', 'prepares surfaces and paints houses'],
    places: [['43', 'painting contractor']],
    selfEmployed: 0.6
  },
  {
    isco: '7212',
    titles: ['welder', 'welder fabricator', 'arc welder'],
    tasks: ['welds metal gates and window grills', 'cuts and welds steel structures'],
    places: [
      ['25', 'metal workshop'],
      ['33', 'repair workshop'],
      ['30', 'shipyard']
    ],
    selfEmployed: 0.4
  },
  {
    isco: '7231',
    titles: ['car mechanic', 'motor mechanic', 'auto mechanic', 'mechanic'],
    tasks: ['repairs car engines and brakes', 'services vehicles and changes oil and tyres'],
    places: [
      ['45', 'car repair garage'],
      ['45', 'motor vehicle dealer workshop'],
      ['49', 'bus company workshop']
    ],
    selfEmployed: 0.45
  },
  {
    isco: '7233',
    titles: ['tractor mechanic', 'machinery fitter', 'industrial mechanic'],
    tasks: ['repairs tractors and farm machinery', 'maintains the factory machines'],
    places: [
      ['33', 'machinery repair company'],
      ['01', 'large farm']
    ]
  },
  {
    isco: '7234',
    titles: ['bicycle repairer', 'bike mechanic', 'boda boda mechanic'],
    tasks: ['repairs bicycles and motorbikes by the road', 'fixes punctures and chains'],
    places: [
      ['95', 'roadside repair stand'],
      ['45', 'motorcycle repair shop']
    ],
    selfEmployed: 0.85
  },
  {
    isco: '7313',
    titles: ['goldsmith', 'jeweller'],
    tasks: ['makes rings and necklaces from gold and silver', 'repairs jewellery for customers'],
    places: [['32', 'jewellery workshop']],
    selfEmployed: 0.6
  },
  {
    isco: '7322',
    titles: ['printer', 'printing machine operator', 'offset printer'],
    tasks: ['runs the printing press for books and posters', 'prints t-shirts and banners'],
    places: [
      ['18', 'printing press'],
      ['18', 'print shop']
    ],
    selfEmployed: 0.3
  },
  {
    isco: '7411',
    titles: ['electrician', 'house wiring electrician', 'building electrician'],
    tasks: ['wires new houses and installs sockets', 'repairs electrical faults in buildings'],
    places: [
      ['43', 'electrical contractor'],
      ['35', 'power company']
    ],
    selfEmployed: 0.45
  },
  {
    isco: '7421',
    titles: ['electronics repairer', 'TV and radio repairer', 'phone repair technician'],
    tasks: ['repairs mobile phones and replaces screens', 'repairs TVs, radios and decoders'],
    places: [
      ['95', 'phone repair shop'],
      ['95', 'electronics repair kiosk']
    ],
    selfEmployed: 0.75
  },
  {
    isco: '7511',
    titles: ['butcher', 'meat cutter', 'fishmonger'],
    tasks: ['cuts and sells meat to customers', 'slaughters goats and sells meat'],
    places: [
      ['47', 'butchery'],
      ['10', 'meat processing plant']
    ],
    selfEmployed: 0.5
  },
  {
    isco: '7512',
    titles: ['baker', 'pastry cook', 'cake maker'],
    tasks: ['bakes bread and buns early in the morning', 'makes cakes for weddings and birthdays'],
    places: [
      ['10', 'bakery'],
      ['10', 'home bakery']
    ],
    selfEmployed: 0.4
  },
  {
    isco: '7522',
    titles: ['furniture maker', 'cabinet maker', 'fundi wa mbao'],
    tasks: ['makes beds, tables and sofas from wood', 'makes kitchen cabinets to order'],
    places: [
      ['31', 'furniture workshop'],
      ['31', 'own carpentry workshop']
    ],
    selfEmployed: 0.6
  },
  {
    isco: '7531',
    titles: ['tailor', 'dressmaker', 'seamstress'],
    tasks: ['sews dresses and suits for customers', 'makes and repairs clothes on a sewing machine'],
    places: [
      ['14', 'own tailoring shop'],
      ['14', 'tailoring workshop'],
      ['95', 'clothes repair stand']
    ],
    selfEmployed: 0.75
  },
  {
    isco: '7536',
    titles: ['shoemaker', 'cobbler', 'shoe repairer'],
    tasks: ['repairs shoes by the road', 'makes leather sandals'],
    places: [
      ['15', 'leather workshop'],
      ['95', 'shoe repair stand']
    ],
    selfEmployed: 0.85
  },

  // 8 Plant and machine operators, and assemblers
  {
    isco: '8111',
    titles: ['miner', 'underground miner', 'quarry worker (drilling)'],
    tasks: ['drills and blasts rock underground', 'extracts copper ore in the mine'],
    places: [
      ['07', 'copper mine'],
      ['07', 'gold mine'],
      ['08', 'stone quarry']
    ]
  },
  {
    isco: '8142',
    titles: ['plastic machine operator', 'injection moulding operator', 'extrusion operator'],
    tasks: ['operates the machine that makes plastic bottles', 'sets and watches the moulding machines'],
    places: [['22', 'plastic products factory']]
  },
  {
    isco: '8153',
    titles: ['sewing machine operator', 'machinist', 'machine operator garments'],
    tasks: ['sews shirts on the production line', 'operates an industrial sewing machine'],
    places: [
      ['14', 'garment factory'],
      ['14', 'textile export factory']
    ]
  },
  {
    isco: '8160',
    titles: ['food machine operator', 'mill operator', 'bottling line operator food'],
    tasks: ['operates the flour milling machine', 'runs the machine that packs biscuits'],
    places: [
      ['10', 'flour mill'],
      ['10', 'biscuit factory'],
      ['11', 'juice factory']
    ]
  },
  {
    isco: '8183',
    titles: ['packing machine operator', 'bottling machine operator', 'labelling operator'],
    tasks: ['runs the bottling and labelling machine', 'feeds the packing machine and checks seals'],
    places: [
      ['11', 'brewery'],
      ['21', 'pharmaceutical factory'],
      ['20', 'detergent factory']
    ]
  },
  {
    isco: '8212',
    titles: ['electronics assembler', 'assembly line worker electronics'],
    tasks: ['assembles circuit boards and phone chargers', 'puts together electrical parts on the line'],
    places: [
      ['26', 'electronics factory'],
      ['27', 'cable and switch factory']
    ]
  },
  {
    isco: '8321',
    titles: ['boda boda rider', 'motorcycle taxi driver', 'delivery rider'],
    tasks: ['carries passengers on a motorbike', 'delivers food orders on a motorbike'],
    places: [
      ['49', 'motorcycle taxi, own bike'],
      ['53', 'food delivery app']
    ],
    selfEmployed: 0.8
  },
  {
    isco: '8322',
    titles: ['taxi driver', 'driver', 'company driver', 'van driver'],
    tasks: [
      'drives a taxi and takes passengers around town',
      'drives the manager and delivers documents',
      'delivers goods with a van'
    ],
    places: [
      ['49', 'taxi'],
      ['84', 'ministry'],
      ['46', 'wholesale distributor']
    ],
    selfEmployed: 0.4
  },
  {
    isco: '8331',
    titles: ['bus driver', 'matatu driver', 'minibus driver'],
    tasks: ['drives a minibus on a fixed route', 'drives the city bus'],
    places: [
      ['49', 'bus company'],
      ['49', 'matatu sacco']
    ],
    selfEmployed: 0.2
  },
  {
    isco: '8332',
    titles: ['truck driver', 'lorry driver', 'long distance driver'],
    tasks: ['transports goods by truck to other towns', 'drives a tanker delivering fuel'],
    places: [
      ['49', 'transport company'],
      ['49', 'trucking company'],
      ['23', 'cement company']
    ],
    selfEmployed: 0.15
  },
  {
    isco: '8342',
    titles: ['excavator operator', 'grader operator', 'bulldozer operator'],
    tasks: ['operates an excavator on road works', 'levels the ground with a grader'],
    places: [
      ['42', 'road construction company'],
      ['08', 'quarry']
    ]
  },
  {
    isco: '8344',
    titles: ['forklift operator', 'forklift driver'],
    tasks: ['moves pallets in the warehouse with a forklift', 'loads trucks with a forklift'],
    places: [
      ['52', 'warehouse'],
      ['52', 'port container terminal'],
      ['11', 'brewery']
    ]
  },

  // 9 Elementary occupations
  {
    isco: '9111',
    titles: ['house girl', 'domestic worker', 'maid', 'house help'],
    tasks: ['cleans the house, washes clothes and cooks', 'does housework and looks after the children'],
    places: [
      ['97', 'private household'],
      ['97', 'works for a family']
    ]
  },
  {
    isco: '9112',
    titles: ['cleaner', 'office cleaner', 'hotel cleaner', 'room attendant'],
    tasks: ['cleans offices and toilets', 'cleans hotel rooms and changes bed linen'],
    places: [
      ['81', 'cleaning company'],
      ['55', 'hotel'],
      ['86', 'hospital']
    ]
  },
  {
    isco: '9122',
    titles: ['car washer', 'car wash attendant'],
    tasks: ['washes cars by hand', 'cleans vehicles at the car wash'],
    places: [
      ['45', 'car wash'],
      ['96', 'roadside car wash']
    ],
    selfEmployed: 0.5
  },
  {
    isco: '9211',
    titles: ['farm labourer', 'farm worker', 'casual worker on farm', 'tea picker'],
    tasks: ['weeds and harvests crops for daily pay', 'picks tea leaves on the estate'],
    places: [
      ['01', 'tea estate'],
      ['01', 'flower farm'],
      ['01', "neighbour's farm"]
    ]
  },
  {
    isco: '9212',
    titles: ['herdsman', 'herder', 'farm hand (cattle)'],
    tasks: ['herds cattle and goats for the owner', 'milks cows and cleans the sheds'],
    places: [
      ['01', 'dairy farm'],
      ['01', 'ranch']
    ]
  },
  {
    isco: '9214',
    titles: ['garden labourer', 'grounds worker', 'shamba boy'],
    tasks: ['cuts grass and waters the garden', 'digs and weeds the compound'],
    places: [
      ['81', 'landscaping company'],
      ['97', 'private household']
    ]
  },
  {
    isco: '9313',
    titles: ['construction labourer', 'casual labourer construction', 'building site helper', 'mjengo worker'],
    tasks: ['carries bricks and mixes cement on site', 'digs foundations and helps masons'],
    places: [
      ['41', 'building site'],
      ['41', 'construction company']
    ]
  },
  {
    isco: '9312',
    titles: ['road worker', 'civil works labourer'],
    tasks: ['digs trenches and clears drains on road works', 'helps lay pipes and cables'],
    places: [
      ['42', 'road construction company'],
      ['36', 'water utility works']
    ]
  },
  {
    isco: '9321',
    titles: ['packer', 'hand packer', 'packaging worker'],
    tasks: ['packs products into boxes by hand', 'packs flowers for export'],
    places: [
      ['10', 'food factory'],
      ['01', 'flower packhouse'],
      ['52', 'distribution centre']
    ]
  },
  {
    isco: '9329',
    titles: ['factory worker', 'general worker factory', 'casual in factory'],
    tasks: ['carries materials and cleans machines in the factory', 'helps the machine operators'],
    places: [
      ['22', 'plastic factory'],
      ['23', 'brick factory'],
      ['24', 'steel mill']
    ]
  },
  {
    isco: '9333',
    titles: ['loader', 'porter', 'warehouse worker', 'turnboy'],
    tasks: ['loads and offloads trucks', 'carries sacks in the warehouse'],
    places: [
      ['52', 'warehouse'],
      ['52', 'bus park'],
      ['46', 'cereals wholesaler']
    ]
  },
  {
    isco: '9334',
    titles: ['shelf stacker', 'shelf filler', 'merchandiser'],
    tasks: ['fills shelves in the supermarket', 'arranges products and checks prices'],
    places: [['47', 'supermarket']]
  },
  {
    isco: '9412',
    titles: ['kitchen helper', 'kitchen hand', 'dishwasher'],
    tasks: ['washes dishes and peels vegetables', 'cleans the kitchen and helps the cook'],
    places: [
      ['56', 'restaurant'],
      ['55', 'hotel kitchen'],
      ['85', 'boarding school kitchen']
    ]
  },
  {
    isco: '9520',
    titles: ['hawker', 'street vendor', 'sells sweets and airtime on the street'],
    tasks: ['sells sweets, cigarettes and airtime on the street', 'walks around selling sunglasses and phone covers'],
    places: [
      ['47', 'street selling, no fixed place'],
      ['47', 'hawking in town']
    ],
    selfEmployed: 0.95
  },
  {
    isco: '9611',
    titles: ['garbage collector', 'waste collector', 'recycler'],
    tasks: ['collects garbage from houses with a truck', 'collects plastic bottles to sell for recycling'],
    places: [
      ['38', 'waste collection company'],
      ['84', 'city council'],
      ['38', 'own work collecting scrap']
    ],
    selfEmployed: 0.3
  },
  {
    isco: '9613',
    titles: ['street sweeper', 'sweeper'],
    tasks: ['sweeps the streets and market', 'cleans public places for the council'],
    places: [
      ['84', 'municipal council'],
      ['81', 'cleaning contractor']
    ]
  },
  {
    isco: '9621',
    titles: ['messenger', 'office messenger', 'delivery boy'],
    tasks: ['delivers letters and parcels in town', 'carries documents between offices'],
    places: [
      ['53', 'courier company'],
      ['84', 'ministry'],
      ['69', 'law firm']
    ]
  },
  {
    isco: '9622',
    titles: ['handyman', 'odd jobs', 'casual worker (any work)'],
    tasks: ['does small repairs and odd jobs for people', 'any work that comes, carrying, cleaning, digging'],
    places: [
      ['96', 'works for different people'],
      ['81', 'maintenance services']
    ],
    selfEmployed: 0.7
  },

  // 0 Armed forces occupations
  {
    isco: '0110',
    titles: ['army officer', 'lieutenant', 'captain in the army'],
    tasks: ['commands a platoon and trains soldiers', 'plans operations and leads the unit'],
    places: [
      ['84', 'national army'],
      ['84', 'defence forces']
    ]
  },
  {
    isco: '0210',
    titles: ['sergeant', 'corporal', 'non-commissioned officer'],
    tasks: ['supervises soldiers and their training', 'leads a section of soldiers'],
    places: [
      ['84', 'army'],
      ['84', 'air force']
    ]
  },
  {
    isco: '0310',
    titles: ['soldier', 'private (army)', 'military'],
    tasks: ['guards the barracks and goes on patrol', 'serves in the army'],
    places: [
      ['84', 'army'],
      ['84', 'navy']
    ]
  }
]

/**
 * Answers too vague to code fully. `isco` and `isic` are the prefixes a coder
 * can still defend; the rest of the path is unknown. Coders flag these and
 * discuss them.
 */
export const VAGUE: Array<{ title: string; tasks: string | null; place: string | null; isco: string; isic: string }> = [
  { title: 'worker', tasks: 'works', place: 'a company', isco: '', isic: '' },
  { title: 'business', tasks: 'my own business', place: null, isco: '', isic: '' },
  { title: 'manager', tasks: 'manages', place: 'family business', isco: '1', isic: '' },
  { title: 'technician', tasks: 'technical work', place: 'factory', isco: '3', isic: 'C' },
  { title: 'helper', tasks: 'helps on the site', place: 'construction', isco: '9', isic: 'F' },
  { title: 'casual', tasks: 'any work', place: null, isco: '9', isic: '' },
  { title: 'employed', tasks: null, place: 'government', isco: '', isic: 'O' },
  { title: 'self employed', tasks: 'selling', place: 'own business', isco: '', isic: 'G' },
  { title: 'officer', tasks: 'office work', place: 'ministry', isco: '', isic: 'O' },
  { title: 'NGO', tasks: 'project work', place: 'NGO', isco: '', isic: 'S' },
  { title: 'teacher?', tasks: 'teaches and also farms', place: 'school and own farm', isco: '2', isic: '' },
  {
    title: 'driver / mechanic',
    tasks: 'drives and repairs the company vehicles',
    place: 'transport company',
    isco: '',
    isic: 'H'
  }
]

/** Support columns: where and how the answer was collected. */
export const REGIONS = ['Central', 'Coast', 'Eastern', 'Lake', 'Northern', 'Rift Valley', 'Western', 'Capital City']
export const AGE_GROUPS = ['15-24', '25-34', '35-44', '45-54', '55-64', '65+']
export const SEXES = ['Female', 'Male']
