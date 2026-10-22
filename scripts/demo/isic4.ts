// ISIC Rev.4, the International Standard Industrial Classification of All
// Economic Activities (UN), to division level: sections (letters) and their
// two-digit divisions. One node per line: the code, a space, the label; a
// division belongs to the section above it. Definitions are short summaries
// for the demo, not the official texts.

export const ISIC4_LEVEL_NAMES = { '1': 'Section', '2': 'Division' }

export const ISIC4_DEFINITIONS: Record<string, string> = {
  A: 'Exploitation of plant and animal natural resources: growing crops, raising and breeding animals, harvesting timber and catching fish.',
  B: 'Extraction of minerals occurring naturally as solids, liquids or gases, and the supporting activities that prepare the material for marketing.',
  C: 'Physical or chemical transformation of materials, substances or components into new products, including repair and installation of machinery.',
  D: 'Providing electric power, natural gas, steam and hot water through a permanent infrastructure of lines, mains and pipes.',
  E: 'Water collection and supply, sewerage, and the collection, treatment and disposal of waste, including the recovery of materials.',
  F: 'General and specialized construction of buildings and civil engineering works, including new work, repair, additions and alterations.',
  G: 'Resale without transformation of new and used goods, to businesses or the public, and the repair of motor vehicles and motorcycles.',
  H: 'Transport of passengers or freight by rail, pipeline, road, water or air, with warehousing, cargo handling, postal and courier activities.',
  I: 'Short-stay accommodation for visitors and travellers, and the provision of complete meals and drinks fit for immediate consumption.',
  J: 'Production and distribution of information and cultural products, telecommunications, IT and data processing, and other information services.',
  K: 'Financial service activities, including insurance, reinsurance and pension funding, and activities that support financial services.',
  L: 'Lessors, agents and brokers selling or buying real estate, renting real estate, and managing real estate on a fee or contract basis.',
  M: 'Specialized professional, scientific and technical activities that require a high degree of training and make specialized knowledge available to users.',
  N: 'Routine activities that support general business operations: rental, employment agencies, travel agencies, security, cleaning and office support.',
  O: 'Activities of a governmental nature normally carried out by the public administration: legislation, taxation, defence, public order and safety, and compulsory social security.',
  P: 'Education at any level or for any profession, public or private, oral or written, by radio, television, the internet or correspondence.',
  Q: 'Health care by trained medical professionals in hospitals and elsewhere, residential care with a health component, and social work without accommodation.',
  R: 'Activities that meet varied cultural, entertainment and recreational interests of the public, including live performances, museums, gambling and sports.',
  S: 'Activities of membership organizations, repair of computers and personal and household goods, and other personal services such as laundry and hairdressing.',
  T: 'Activities of households as employers of domestic personnel, and the undifferentiated production of goods and services by households for their own use.',
  U: 'Activities of international organizations such as the United Nations and its agencies, and foreign embassies.'
}

export const ISIC4 = `
A Agriculture, forestry and fishing
01 Crop and animal production, hunting and related service activities
02 Forestry and logging
03 Fishing and aquaculture
B Mining and quarrying
05 Mining of coal and lignite
06 Extraction of crude petroleum and natural gas
07 Mining of metal ores
08 Other mining and quarrying
09 Mining support service activities
C Manufacturing
10 Manufacture of food products
11 Manufacture of beverages
12 Manufacture of tobacco products
13 Manufacture of textiles
14 Manufacture of wearing apparel
15 Manufacture of leather and related products
16 Manufacture of wood and of products of wood and cork, except furniture; manufacture of articles of straw and plaiting materials
17 Manufacture of paper and paper products
18 Printing and reproduction of recorded media
19 Manufacture of coke and refined petroleum products
20 Manufacture of chemicals and chemical products
21 Manufacture of basic pharmaceutical products and pharmaceutical preparations
22 Manufacture of rubber and plastics products
23 Manufacture of other non-metallic mineral products
24 Manufacture of basic metals
25 Manufacture of fabricated metal products, except machinery and equipment
26 Manufacture of computer, electronic and optical products
27 Manufacture of electrical equipment
28 Manufacture of machinery and equipment not elsewhere classified
29 Manufacture of motor vehicles, trailers and semi-trailers
30 Manufacture of other transport equipment
31 Manufacture of furniture
32 Other manufacturing
33 Repair and installation of machinery and equipment
D Electricity, gas, steam and air conditioning supply
35 Electricity, gas, steam and air conditioning supply
E Water supply; sewerage, waste management and remediation activities
36 Water collection, treatment and supply
37 Sewerage
38 Waste collection, treatment and disposal activities; materials recovery
39 Remediation activities and other waste management services
F Construction
41 Construction of buildings
42 Civil engineering
43 Specialized construction activities
G Wholesale and retail trade; repair of motor vehicles and motorcycles
45 Wholesale and retail trade and repair of motor vehicles and motorcycles
46 Wholesale trade, except of motor vehicles and motorcycles
47 Retail trade, except of motor vehicles and motorcycles
H Transportation and storage
49 Land transport and transport via pipelines
50 Water transport
51 Air transport
52 Warehousing and support activities for transportation
53 Postal and courier activities
I Accommodation and food service activities
55 Accommodation
56 Food and beverage service activities
J Information and communication
58 Publishing activities
59 Motion picture, video and television programme production, sound recording and music publishing activities
60 Programming and broadcasting activities
61 Telecommunications
62 Computer programming, consultancy and related activities
63 Information service activities
K Financial and insurance activities
64 Financial service activities, except insurance and pension funding
65 Insurance, reinsurance and pension funding, except compulsory social security
66 Activities auxiliary to financial service and insurance activities
L Real estate activities
68 Real estate activities
M Professional, scientific and technical activities
69 Legal and accounting activities
70 Activities of head offices; management consultancy activities
71 Architectural and engineering activities; technical testing and analysis
72 Scientific research and development
73 Advertising and market research
74 Other professional, scientific and technical activities
75 Veterinary activities
N Administrative and support service activities
77 Rental and leasing activities
78 Employment activities
79 Travel agency, tour operator, reservation service and related activities
80 Security and investigation activities
81 Services to buildings and landscape activities
82 Office administrative, office support and other business support activities
O Public administration and defence; compulsory social security
84 Public administration and defence; compulsory social security
P Education
85 Education
Q Human health and social work activities
86 Human health activities
87 Residential care activities
88 Social work activities without accommodation
R Arts, entertainment and recreation
90 Creative, arts and entertainment activities
91 Libraries, archives, museums and other cultural activities
92 Gambling and betting activities
93 Sports activities and amusement and recreation activities
S Other service activities
94 Activities of membership organizations
95 Repair of computers and personal and household goods
96 Other personal service activities
T Activities of households as employers; undifferentiated goods- and services-producing activities of households for own use
97 Activities of households as employers of domestic personnel
98 Undifferentiated goods- and services-producing activities of private households for own use
U Activities of extraterritorial organizations and bodies
99 Activities of extraterritorial organizations and bodies
`
