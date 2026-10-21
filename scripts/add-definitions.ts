import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Find ISCO taxonomy
  const iscoTaxonomy = await prisma.taxonomy.findUnique({
    where: { key: 'ISCO' }
  })

  if (!iscoTaxonomy) {
    console.error('ISCO taxonomy not found')
    return
  }

  console.log('Adding definitions to ISCO nodes...')

  // Definitions to add
  const definitions: Array<{ code: number; definition: string }> = [
    {
      code: 1,
      definition: 'Managers plan, direct, coordinate and evaluate the overall activities of enterprises, governments and other organizations, or of organizational units within them, and formulate and review their policies, laws, rules and regulations.'
    },
    {
      code: 2,
      definition: 'Professionals increase the existing stock of knowledge, apply scientific or artistic concepts and theories, teach about the foregoing in a systematic manner, or engage in any combination of these activities.'
    },
    {
      code: 3,
      definition: 'Technicians and associate professionals perform mostly technical and related tasks connected with research and the application of scientific or artistic concepts and operational methods, and government or business regulations.'
    },
    {
      code: 4,
      definition: 'Clerical support workers record, organize, store, compute and retrieve information, and perform a number of clerical duties in connection with money-handling operations, travel arrangements, requests for information and appointments.'
    },
    {
      code: 22,
      definition: 'Health professionals conduct research, improve or develop concepts, theories and operational methods, or apply knowledge relating to diagnosis and treatment of disease, ailments and injuries.'
    },
    {
      code: 23,
      definition: 'Teaching professionals teach the theory and practice of one or more disciplines at different educational levels, conduct research and improve or develop concepts, theories and operational methods pertaining to their particular discipline.'
    },
    {
      code: 222,
      definition: 'Nursing professionals provide treatment, support and care services for people who are in need of nursing care due to the effects of ageing, injury, illness or other physical or mental impairment, or who require assistance with activities of daily living.'
    },
    {
      code: 2221,
      definition: 'Nursing professionals provide **nursing care services** to patients in hospitals, clinics, nursing homes, and other healthcare settings. They:\n\n- Assess patient needs and develop care plans\n- Administer medications and treatments\n- Coordinate with other healthcare professionals\n- Monitor patient progress and respond to changes in condition\n\nThey work as part of a multidisciplinary healthcare team to ensure the best possible patient outcomes.'
    },
    {
      code: 2222,
      definition: 'Midwifery professionals provide care and support to women during pregnancy, childbirth, and the postpartum period. They provide health education and counseling, monitor maternal and fetal health, and assist with deliveries.'
    },
    {
      code: 24,
      definition: 'Business and administration professionals provide financial, administrative, human resource and other specialized business services, or apply economic, accounting, financial, mathematical, statistical, actuarial or administrative principles and methods.'
    },
    {
      code: 241,
      definition: 'Finance professionals provide financial services, including banking, investment and insurance services, and conduct financial analysis and research.'
    },
    {
      code: 242,
      definition: 'Administration professionals perform administrative functions in support of the operations of organizations, including policy development, human resources, accounting, procurement and contract management.'
    }
  ]

  // Update nodes with definitions
  for (const { code, definition } of definitions) {
    const updated = await prisma.taxonomyNode.updateMany({
      where: {
        taxonomyId: iscoTaxonomy.id,
        code: String(code)
      },
      data: {
        definition: definition
      }
    })
    
    if (updated.count > 0) {
      console.log(`✓ Added definition to code ${code}`)
    } else {
      console.log(`✗ Node with code ${code} not found`)
    }
  }

  console.log('\nDone!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

