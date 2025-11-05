pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FeatureVote is ZamaEthereumConfig {
    struct Feature {
        string name;
        euint32 encryptedVotes;
        uint256 featureId;
        address creator;
        uint256 timestamp;
        uint32 decryptedVotes;
        bool isVerified;
    }

    mapping(uint256 => Feature) public features;
    uint256[] public featureIds;

    event FeatureCreated(uint256 indexed featureId, address indexed creator);
    event VotesVerified(uint256 indexed featureId, uint32 decryptedVotes);

    constructor() ZamaEthereumConfig() {}

    function createFeature(
        string calldata name,
        externalEuint32 encryptedVotes,
        bytes calldata inputProof,
        uint256 featureId
    ) external {
        require(featureId > 0, "Invalid feature ID");
        require(features[featureId].creator == address(0), "Feature already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedVotes, inputProof)), "Invalid encrypted input");

        features[featureId] = Feature({
            name: name,
            encryptedVotes: FHE.fromExternal(encryptedVotes, inputProof),
            featureId: featureId,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedVotes: 0,
            isVerified: false
        });

        FHE.allowThis(features[featureId].encryptedVotes);
        FHE.makePubliclyDecryptable(features[featureId].encryptedVotes);

        featureIds.push(featureId);
        emit FeatureCreated(featureId, msg.sender);
    }

    function verifyVotes(
        uint256 featureId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(features[featureId].creator != address(0), "Feature does not exist");
        require(!features[featureId].isVerified, "Votes already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(features[featureId].encryptedVotes);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        features[featureId].decryptedVotes = decodedValue;
        features[featureId].isVerified = true;

        emit VotesVerified(featureId, decodedValue);
    }

    function getEncryptedVotes(uint256 featureId) external view returns (euint32) {
        require(features[featureId].creator != address(0), "Feature does not exist");
        return features[featureId].encryptedVotes;
    }

    function getFeature(uint256 featureId) external view returns (
        string memory name,
        uint256 featureIdValue,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedVotes
    ) {
        require(features[featureId].creator != address(0), "Feature does not exist");
        Feature storage feature = features[featureId];

        return (
            feature.name,
            feature.featureId,
            feature.creator,
            feature.timestamp,
            feature.isVerified,
            feature.decryptedVotes
        );
    }

    function getAllFeatureIds() external view returns (uint256[] memory) {
        return featureIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

