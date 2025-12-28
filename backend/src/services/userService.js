const usersRepository = require('../repositories/usersRepository');
const { AppError } = require('../utils/appError');
const { httpStatus } = require('../utils/httpStatus');

async function listAllUsers({ currentUserId }) {
  return usersRepository.listAllExceptUser(currentUserId);
}

async function getPublicKey({ userId }) {
  const pk = await usersRepository.getPublicKeyById(userId);
  if (!pk) throw new AppError('user not found', { status: httpStatus.NOT_FOUND, code: 'USER_NOT_FOUND' });
  return pk;
}

async function listContacts({ currentUserId }) {
  return usersRepository.listContactsForUser(currentUserId);
}

module.exports = { listAllUsers, getPublicKey, listContacts };
