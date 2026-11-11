/**
 * Cliente Prisma compartido (singleton) para el backend.
 */
const { PrismaClient } = require('@prisma/client')

let _prisma = null

function getPrismaClient() {
  if (!_prisma) {
    _prisma = new PrismaClient()
  }
  return _prisma
}

function newPrismaClient(datasourceUrl) {
  return new PrismaClient({ datasources: { db: { url: datasourceUrl } } })
}

module.exports = { getPrismaClient, newPrismaClient }
