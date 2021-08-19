'use strict'

const { expect } = require('chai')
const { ethers, network } = require('hardhat')

const SWAP_MANAGER_ADDRESS = '0xe382d9f2394A359B01006faa8A1864b8a60d2710'

const DEX_UNISWAP = 0

const VSP_ADDRESS = '0x1b40183EFB4Dd766f11bDa7A7c3AD8982e998421'
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const usdAmount = ethers.utils.parseEther('100000')

describe('Security checks', function () {
  let paymentStreamFactory
  let fakeToken

  before(async function () {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.NODE_URL
          }
        }
      ]
    })

    const FakeERC20 = await ethers.getContractFactory('FakeERC20')
    fakeToken = await FakeERC20.deploy(ethers.utils.parseEther('1000000'))

    const PaymentStreamFactory = await ethers.getContractFactory(
      'PaymentStreamFactory'
    )
    paymentStreamFactory = await PaymentStreamFactory.deploy(
      SWAP_MANAGER_ADDRESS
    )

    await Promise.all([fakeToken.deployed(), paymentStreamFactory.deployed()])

    await paymentStreamFactory.addToken(fakeToken.address, DEX_UNISWAP, [
      USDC_ADDRESS,
      WETH_ADDRESS,
      VSP_ADDRESS
    ])
  })

  describe('createStream', function () {
    it('endTime < current time should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        usdAmount,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp - 1
      )

      expect(createStreamTx).to.be.revertedWith('invalid-end-time')
    })

    it('usdAmount = 0 should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        0,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('usd-amount-is-0')
    })

    it('payee = fundingAddress should revert', async function () {
      const [, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        usdAmount,
        fakeToken.address,
        payee.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('payee-is-funding-address')
    })

    it('payee and fundingAddress cannot be null', async function () {
      const [fundingAddress] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        ethers.constants.AddressZero,
        usdAmount,
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('payee-or-funding-address-is-0')
    })

    it('createStream with unsupported token should revert', async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = paymentStreamFactory.createStream(
        payee.address,
        usdAmount,
        VSP_ADDRESS,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365
      )

      expect(createStreamTx).to.be.revertedWith('token-not-supported')
    })
  })

  describe('claim', function () {
    let streamId
    let paymentStream

    before(async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = await paymentStreamFactory.createStream(
        payee.address,
        usdAmount, // usdAmount scaled up to 18 decimals
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365 // 1 year
      )

      const { events } = await createStreamTx.wait()

      const event = events.find(newEvent => newEvent.event === 'StreamCreated')

      streamId = event.args.id

      const streamAddress = await paymentStreamFactory.getStream(streamId)

      paymentStream = await ethers.getContractAt('PaymentStream', streamAddress)
    })

    it('Claiming on paused stream should revert', async function () {
      const [, payee] = await ethers.getSigners()

      await paymentStream.pauseStream()

      const payeePaymentStream = await paymentStream.connect(payee)

      const claimTx = payeePaymentStream.claim()

      expect(claimTx).to.be.revertedWith('stream-is-paused')
    })

    it('Claiming from non-payee should revert', async function () {
      const [, , nonPayee] = await ethers.getSigners()

      const nonPayeePaymentStream = await paymentStream.connect(nonPayee)

      const claimTx = nonPayeePaymentStream.claim()

      expect(claimTx).to.be.revertedWith('not-payee')
    })
  })

  describe('Editing a stream', function () {
    let streamId
    let paymentStream

    before(async function () {
      const [fundingAddress, payee] = await ethers.getSigners()

      const blockInfo = await ethers.provider.getBlock('latest')

      const createStreamTx = await paymentStreamFactory.createStream(
        payee.address,
        usdAmount, // usdAmount scaled up to 18 decimals
        fakeToken.address,
        fundingAddress.address,
        blockInfo.timestamp + 86400 * 365 // 1 year
      )

      const { events } = await createStreamTx.wait()

      const event = events.find(newEvent => newEvent.event === 'StreamCreated')

      streamId = event.args.id

      const streamAddress = await paymentStreamFactory.getStream(streamId)

      paymentStream = await ethers.getContractAt('PaymentStream', streamAddress)
    })

    describe('delegatePausable', function () {
      it('Delegating to invalid address should revert', async function () {
        const check = paymentStream.delegatePausable(
          ethers.constants.AddressZero
        )

        expect(check).to.be.revertedWith('invalid-delegate')
      })
    })

    describe('updateFundingAddress', function () {
      it('Setting an invalid funding address should revert', async function () {
        const check = paymentStream.updateFundingAddress(
          ethers.constants.AddressZero
        )

        expect(check).to.be.revertedWith('invalid-new-funding-address')
      })
    })

    describe('updatePayee', function () {
      it('Setting an invalid payee address should revert', async function () {
        const check = paymentStream.updatePayee(ethers.constants.AddressZero)

        expect(check).to.be.revertedWith('invalid-new-payee')
      })
    })

    describe('updateFundingRate', function () {
      it('endTime < current time should revert', async function () {
        const blockInfo = await ethers.provider.getBlock('latest')

        const check = paymentStream.updateFundingRate(
          usdAmount,
          blockInfo.timestamp - 86400
        )

        expect(check).to.be.revertedWith('invalid-end-time')
      })
    })

    describe('updateSwapManager', function () {
      it('Setting 0 address should revert', async function () {
        expect(
          paymentStreamFactory.updateSwapManager(
            '0x0000000000000000000000000000000000000000'
          )
        ).to.be.revertedWith('invalid-swap-manager-address')
      })
      it('Setting SwapManager address should emit an event', async function () {
        const NEW_SWAP_MANAGER_ADDRESS =
          '0xC48ea9A2daA4d816e4c9333D6689C70070010174'

        expect(paymentStreamFactory.updateSwapManager(NEW_SWAP_MANAGER_ADDRESS))
          .to.emit(paymentStreamFactory, 'SwapManagerUpdated')
          .withArgs(SWAP_MANAGER_ADDRESS, NEW_SWAP_MANAGER_ADDRESS)
      })
    })
  })
})
